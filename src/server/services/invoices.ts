import "server-only";
import { z } from "zod";
import type { InvoiceDirection, Prisma } from "@prisma/client";
import { withTenant, type Tx } from "../db";
import { assertCan, type TenantContext } from "../context";
import { AppError, NotFoundError } from "../errors";
import { audit, diff } from "../audit";
import { dec, loadSettings, paise, requireCounterparty } from "./common";
import { parseAmount } from "@/domain/money";
import { computeDueDate } from "@/domain/invoiceStatus";
import { fromDbDate, isISODate, toDbDate } from "@/domain/dates";
import { syncInvoiceReminders } from "./reminderJobs";

const optionalAmount = z
  .string()
  .optional()
  .transform((v, c) => {
    if (v === undefined || v.trim() === "") return null;
    try {
      const p = parseAmount(v);
      if (p < 0n) throw new Error();
      return p;
    } catch {
      c.addIssue({ code: "custom", message: "Enter a valid amount" });
      return z.NEVER;
    }
  });

const requiredAmount = z.string().transform((v, c) => {
  try {
    const p = parseAmount(v);
    if (p <= 0n) {
      c.addIssue({ code: "custom", message: "Amount must be greater than zero" });
      return z.NEVER;
    }
    return p;
  } catch (e) {
    c.addIssue({ code: "custom", message: e instanceof Error ? e.message : "Enter a valid amount" });
    return z.NEVER;
  }
});

const isoDate = z.string().refine(isISODate, "Enter a valid date");
const optText = (max = 500) => z.string().max(max).optional().transform((v) => (v && v.trim() !== "" ? v.trim() : null));

export const invoiceInputSchema = z
  .object({
    counterpartyId: z.string().uuid("Select an account"),
    invoiceNumber: z.string().trim().min(1, "Invoice number is required").max(60),
    invoiceDate: isoDate,
    paymentTerms: optText(120),
    creditDays: z
      .string()
      .optional()
      .transform((v, c) => {
        if (!v || v.trim() === "") return null;
        const n = Number(v);
        if (!Number.isInteger(n) || n < 0 || n > 365) {
          c.addIssue({ code: "custom", message: "Credit period must be 0–365 days" });
          return z.NEVER;
        }
        return n;
      }),
    dueDateMode: z.enum(["calculated", "manual"]).default("calculated"),
    dueDate: z.string().optional(),
    subtotalAmount: optionalAmount,
    taxAmount: optionalAmount,
    totalAmount: requiredAmount,
    poReference: optText(80),
    deliveryReference: optText(80),
    notes: optText(2000),
    assignedUserId: z.string().optional().transform((v) => (v && v !== "" ? v : null)),
    priority: z.enum(["low", "normal", "high", "critical"]).default("normal"),
    remindersEnabled: z.string().optional().transform((v) => v !== "off" && v !== "false"),
    duplicateOverride: optText(300),
    status: z.enum(["draft", "open"]).default("open"),
  })
  .superRefine((v, c) => {
    if (v.dueDateMode === "manual" && !isISODate(v.dueDate)) c.addIssue({ code: "custom", path: ["dueDate"], message: "Enter the due date" });
    if (v.subtotalAmount !== null && v.taxAmount !== null && v.subtotalAmount + v.taxAmount !== v.totalAmount) {
      c.addIssue({ code: "custom", path: ["totalAmount"], message: "Total must equal amount before tax plus tax" });
    }
  });

export type InvoiceInput = z.input<typeof invoiceInputSchema>;

const manage = (d: InvoiceDirection) => (d === "receivable" ? "receivables.manage" : "payables.manage");
const view = (d: InvoiceDirection) => (d === "receivable" ? "receivables.view" : "payables.view");

async function assertMember(tx: Tx, businessId: string, userId: string | null) {
  if (!userId) return;
  const m = await tx.membership.findFirst({ where: { businessId, userId, status: "active" } });
  if (!m) throw new AppError("Assigned employee is not a member of this business", { assignedUserId: "Select a team member" });
}

async function findDuplicate(tx: Tx, direction: InvoiceDirection, counterpartyId: string, number: string, excludeId?: string) {
  return tx.invoice.findFirst({
    where: {
      direction,
      invoiceNumber: { equals: number, mode: "insensitive" },
      ...(direction === "payable" ? { counterpartyId } : {}),
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true, invoiceNumber: true },
  });
}

/** Creates a receivable invoice or payable bill. Shared by forms and CSV import. */
export async function createInvoiceTx(tx: Tx, ctx: Pick<TenantContext, "businessId" | "userId" | "permissions" | "today">, direction: InvoiceDirection, raw: InvoiceInput, opts: { importBatchId?: string } = {}) {
  assertCan(ctx, manage(direction));
  const input = invoiceInputSchema.parse(raw);
  const cp = await requireCounterparty(tx, input.counterpartyId, direction === "receivable" ? "customer" : "supplier");
  const { business, settings } = await loadSettings(tx, ctx.businessId);
  await assertMember(tx, ctx.businessId, input.assignedUserId);

  const creditDays =
    input.creditDays ??
    (direction === "receivable" ? cp.customerCreditDays ?? business.defaultCustomerCreditDays : cp.supplierCreditDays ?? business.defaultSupplierCreditDays);
  const dueDate = input.dueDateMode === "manual" ? input.dueDate! : computeDueDate(input.invoiceDate, creditDays);
  if (dueDate < input.invoiceDate) throw new AppError("Due date cannot be before the invoice date", { dueDate: "Due date is before invoice date" });

  const dup = await findDuplicate(tx, direction, cp.id, input.invoiceNumber);
  if (dup) {
    if (!input.duplicateOverride) {
      throw new AppError(`Invoice number ${dup.invoiceNumber} already exists${direction === "payable" ? " for this supplier" : ""}.`, {
        invoiceNumber: "Duplicate invoice number",
      });
    }
    assertCan(ctx, "invoices.override_duplicate");
  }

  const invoice = await tx.invoice.create({
    data: {
      businessId: ctx.businessId,
      direction,
      counterpartyId: cp.id,
      invoiceNumber: input.invoiceNumber,
      invoiceDate: toDbDate(input.invoiceDate),
      paymentTerms: input.paymentTerms ?? cp.paymentTerms,
      creditDays: input.dueDateMode === "manual" ? input.creditDays : creditDays,
      dueDate: toDbDate(dueDate),
      dueDateManual: input.dueDateMode === "manual",
      subtotalAmount: input.subtotalAmount !== null ? dec(input.subtotalAmount) : null,
      taxAmount: input.taxAmount !== null ? dec(input.taxAmount) : null,
      totalAmount: dec(input.totalAmount),
      outstandingAmount: dec(input.totalAmount),
      lifecycle: input.status,
      poReference: input.poReference,
      deliveryReference: input.deliveryReference,
      notes: input.notes,
      assignedUserId: input.assignedUserId ?? cp.assignedUserId,
      priority: input.priority,
      remindersEnabled: input.remindersEnabled,
      duplicateOverride: dup ? input.duplicateOverride : null,
      importBatchId: opts.importBatchId ?? null,
      createdById: ctx.userId,
    },
  });

  await audit(tx, {
    businessId: ctx.businessId,
    actorUserId: ctx.userId,
    action: direction === "receivable" ? "invoice.created" : "bill.created",
    entityType: "invoice",
    entityId: invoice.id,
    summary: `${direction === "receivable" ? "Invoice" : "Bill"} ${invoice.invoiceNumber} created for ${cp.name}`,
    after: { invoiceNumber: invoice.invoiceNumber, total: input.totalAmount, dueDate, dueDateMode: input.dueDateMode, creditDays },
  });
  if (dup) {
    await audit(tx, {
      businessId: ctx.businessId,
      actorUserId: ctx.userId,
      action: "invoice.duplicate_override",
      entityType: "invoice",
      entityId: invoice.id,
      summary: `Duplicate invoice number ${invoice.invoiceNumber} allowed: ${input.duplicateOverride}`,
      after: { existingInvoiceId: dup.id, reason: input.duplicateOverride },
    });
  }
  await syncInvoiceReminders(tx, ctx.businessId, invoice.id, ctx.today, settings);
  return invoice;
}

export async function createInvoice(ctx: TenantContext, direction: InvoiceDirection, raw: InvoiceInput) {
  return withTenant(ctx.businessId, (tx) => createInvoiceTx(tx, ctx, direction, raw));
}

export const invoiceEditSchema = z.object({
  invoiceNumber: z.string().trim().min(1).max(60),
  invoiceDate: isoDate,
  dueDate: isoDate,
  paymentTerms: optText(120),
  totalAmount: requiredAmount,
  subtotalAmount: optionalAmount,
  taxAmount: optionalAmount,
  poReference: optText(80),
  deliveryReference: optText(80),
  notes: optText(2000),
  assignedUserId: z.string().optional().transform((v) => (v && v !== "" ? v : null)),
  priority: z.enum(["low", "normal", "high", "critical"]).default("normal"),
  remindersEnabled: z.string().optional().transform((v) => v !== "off" && v !== "false"),
  changeReason: optText(300),
});

/**
 * Edits permitted fields. Payment history is never touched: the database
 * recomputes the outstanding balance from allocations, and rejects a new
 * total below what has already been paid.
 */
export async function updateInvoice(ctx: TenantContext, invoiceId: string, raw: z.input<typeof invoiceEditSchema>) {
  const input = invoiceEditSchema.parse(raw);
  return withTenant(ctx.businessId, async (tx) => {
    const inv = await tx.invoice.findUnique({ where: { id: invoiceId } });
    if (!inv) throw new NotFoundError("Invoice");
    assertCan(ctx, manage(inv.direction));
    if (inv.lifecycle === "void") throw new AppError("A void invoice cannot be edited.");
    if (input.dueDate < input.invoiceDate) throw new AppError("Due date cannot be before the invoice date", { dueDate: "Due date is before invoice date" });
    if (input.subtotalAmount !== null && input.taxAmount !== null && input.subtotalAmount + input.taxAmount !== input.totalAmount) {
      throw new AppError("Total must equal amount before tax plus tax", { totalAmount: "Does not match amount before tax plus tax" });
    }
    const settled = paise(inv.amountPaid) + paise(inv.amountAdjusted);
    if (input.totalAmount < settled) {
      throw new AppError("The total cannot be less than the amount already paid or credited.", { totalAmount: "Below amount already settled" });
    }
    if (input.invoiceNumber.toLowerCase() !== inv.invoiceNumber.toLowerCase()) {
      const dup = await findDuplicate(tx, inv.direction, inv.counterpartyId, input.invoiceNumber, inv.id);
      if (dup) throw new AppError(`Invoice number ${dup.invoiceNumber} already exists.`, { invoiceNumber: "Duplicate invoice number" });
    }
    await assertMember(tx, ctx.businessId, input.assignedUserId);
    const oldDue = fromDbDate(inv.dueDate);
    if (oldDue !== input.dueDate && !input.changeReason) {
      throw new AppError("Give a reason for changing the due date.", { changeReason: "Required when the due date changes" });
    }

    const data = {
      invoiceNumber: input.invoiceNumber,
      invoiceDate: toDbDate(input.invoiceDate),
      dueDate: toDbDate(input.dueDate),
      dueDateManual: inv.dueDateManual || oldDue !== input.dueDate,
      paymentTerms: input.paymentTerms,
      totalAmount: dec(input.totalAmount),
      subtotalAmount: input.subtotalAmount !== null ? dec(input.subtotalAmount) : null,
      taxAmount: input.taxAmount !== null ? dec(input.taxAmount) : null,
      poReference: input.poReference,
      deliveryReference: input.deliveryReference,
      notes: input.notes,
      assignedUserId: input.assignedUserId,
      priority: input.priority,
      remindersEnabled: input.remindersEnabled,
    } satisfies Prisma.InvoiceUpdateInput;

    const updated = await tx.invoice.update({ where: { id: inv.id }, data });
    const d = diff(inv as unknown as Record<string, unknown>, data as unknown as Record<string, unknown>);
    if (d.changed.length > 0) {
      await audit(tx, {
        businessId: ctx.businessId,
        actorUserId: ctx.userId,
        action: oldDue !== input.dueDate ? "invoice.due_date_changed" : "invoice.updated",
        entityType: "invoice",
        entityId: inv.id,
        summary:
          oldDue !== input.dueDate
            ? `Due date changed ${oldDue} → ${input.dueDate}: ${input.changeReason}`
            : `Updated ${d.changed.join(", ")}${input.changeReason ? `: ${input.changeReason}` : ""}`,
        before: d.before,
        after: d.after,
      });
    }
    const { settings } = await loadSettings(tx, ctx.businessId);
    await syncInvoiceReminders(tx, ctx.businessId, inv.id, ctx.today, settings);
    return updated;
  });
}

export async function voidInvoice(ctx: TenantContext, invoiceId: string, reason: string) {
  if (!reason || reason.trim().length < 3) throw new AppError("Give a reason for voiding.", { reason: "Required" });
  assertCan(ctx, "invoices.void");
  return withTenant(ctx.businessId, async (tx) => {
    const inv = await tx.invoice.findUnique({ where: { id: invoiceId } });
    if (!inv) throw new NotFoundError("Invoice");
    if (inv.lifecycle === "void") throw new AppError("This invoice is already void.");
    const activeAllocations = await tx.paymentAllocation.count({ where: { invoiceId, status: "active" } });
    if (activeAllocations > 0) {
      throw new AppError("This invoice has payments allocated. Reverse or reallocate them before voiding, so the payment history stays traceable.");
    }
    await tx.invoice.update({ where: { id: invoiceId }, data: { lifecycle: "void", voidReason: reason.trim(), voidedAt: new Date() } });
    await tx.reminderJob.updateMany({ where: { invoiceId, status: "pending" }, data: { status: "cancelled", statusReason: "Invoice voided" } });
    await tx.followUp.updateMany({ where: { invoiceId, status: "pending" }, data: { status: "cancelled", completionNote: "Invoice voided" } });
    await tx.plannedPayment.updateMany({ where: { invoiceId, status: "scheduled" }, data: { status: "cancelled" } });
    await audit(tx, {
      businessId: ctx.businessId,
      actorUserId: ctx.userId,
      action: "invoice.voided",
      entityType: "invoice",
      entityId: invoiceId,
      summary: `${inv.invoiceNumber} voided: ${reason.trim()}`,
      before: { lifecycle: inv.lifecycle },
      after: { lifecycle: "void", reason: reason.trim() },
    });
  });
}

export async function issueDraft(ctx: TenantContext, invoiceId: string) {
  return withTenant(ctx.businessId, async (tx) => {
    const inv = await tx.invoice.findUnique({ where: { id: invoiceId } });
    if (!inv) throw new NotFoundError("Invoice");
    assertCan(ctx, manage(inv.direction));
    if (inv.lifecycle !== "draft") throw new AppError("Only draft invoices can be issued.");
    await tx.invoice.update({ where: { id: invoiceId }, data: { lifecycle: "open" } });
    await audit(tx, { businessId: ctx.businessId, actorUserId: ctx.userId, action: "invoice.issued", entityType: "invoice", entityId: invoiceId, summary: `${inv.invoiceNumber} issued` });
    const { settings } = await loadSettings(tx, ctx.businessId);
    await syncInvoiceReminders(tx, ctx.businessId, invoiceId, ctx.today, settings);
  });
}

export { view as invoiceViewPermission, manage as invoiceManagePermission };
