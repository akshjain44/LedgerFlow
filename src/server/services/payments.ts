import "server-only";
import { z } from "zod";
import type { PaymentDirection } from "@prisma/client";
import { withTenant, type Tx } from "../db";
import { assertCan, type TenantContext } from "../context";
import { AppError, NotFoundError } from "../errors";
import { audit } from "../audit";
import { dec, loadSettings, paise, requireCounterparty } from "./common";
import { parseAmount, formatINR, type Paise } from "@/domain/money";
import { validateAllocations, type AllocationTarget } from "@/domain/allocation";
import { fromDbDate, isISODate, toDbDate } from "@/domain/dates";
import { syncInvoiceReminders } from "./reminderJobs";
import { evaluatePromises } from "./promises";

export const paymentInputSchema = z.object({
  direction: z.enum(["received", "made"]),
  counterpartyId: z.string().uuid("Select an account"),
  amount: z.string().transform((v, c) => {
    try {
      const p = parseAmount(v);
      if (p <= 0n) throw new Error("Amount must be greater than zero");
      return p;
    } catch (e) {
      c.addIssue({ code: "custom", message: e instanceof Error ? e.message : "Enter a valid amount" });
      return z.NEVER;
    }
  }),
  paymentDate: z.string().refine(isISODate, "Enter a valid date"),
  method: z.string().trim().min(1, "Choose a payment method").max(60),
  reference: z.string().max(120).optional().transform((v) => (v && v.trim() ? v.trim() : null)),
  notes: z.string().max(2000).optional().transform((v) => (v && v.trim() ? v.trim() : null)),
  allocations: z
    .array(z.object({ invoiceId: z.string().uuid(), amount: z.string() }))
    .default([])
    .transform((rows, c) => {
      const out: { invoiceId: string; amount: Paise }[] = [];
      for (const r of rows) {
        if (!r.amount || r.amount.trim() === "" || r.amount.trim() === "0") continue;
        try {
          out.push({ invoiceId: r.invoiceId, amount: parseAmount(r.amount) });
        } catch {
          c.addIssue({ code: "custom", path: ["allocations"], message: "Allocation amounts must be valid" });
          return z.NEVER;
        }
      }
      return out;
    }),
});

export type PaymentInput = z.input<typeof paymentInputSchema>;

const invoiceDirectionFor = (d: PaymentDirection) => (d === "received" ? "receivable" : "payable");

async function openTargets(tx: Tx, direction: PaymentDirection, counterpartyId: string) {
  const invoices = await tx.invoice.findMany({
    where: { counterpartyId, direction: invoiceDirectionFor(direction), lifecycle: "open", outstandingAmount: { gt: 0 } },
    select: { id: true, outstandingAmount: true, dueDate: true },
  });
  return new Map<string, AllocationTarget>(
    invoices.map((i) => [i.id, { invoiceId: i.id, outstanding: paise(i.outstandingAmount), dueDate: fromDbDate(i.dueDate) }]),
  );
}

/** After balances change: settle reminders, close system follow-ups, complete planned payments, re-evaluate promises. */
async function afterBalanceChange(tx: Tx, ctx: Pick<TenantContext, "businessId" | "userId" | "today" | "timezone">, counterpartyId: string, invoiceIds: string[]) {
  const { settings } = await loadSettings(tx, ctx.businessId);
  for (const id of invoiceIds) {
    await syncInvoiceReminders(tx, ctx.businessId, id, ctx.today, settings);
    const inv = await tx.invoice.findUniqueOrThrow({ where: { id }, select: { outstandingAmount: true, direction: true } });
    if (paise(inv.outstandingAmount) === 0n) {
      await tx.followUp.updateMany({
        where: { invoiceId: id, status: "pending", source: { in: ["system_overdue", "system_promise"] } },
        data: { status: "cancelled", completionNote: "Invoice settled", completedAt: new Date() },
      });
      if (inv.direction === "payable") {
        await tx.plannedPayment.updateMany({ where: { invoiceId: id, status: "scheduled" }, data: { status: "completed" } });
      }
    }
  }
  await evaluatePromises(tx, { businessId: ctx.businessId, timezone: ctx.timezone, today: ctx.today, counterpartyId, actorUserId: ctx.userId });
}

async function applyAllocations(tx: Tx, ctx: Pick<TenantContext, "businessId" | "userId">, payment: { id: string; amount: unknown; allocatedAmount: unknown; direction: PaymentDirection; counterpartyId: string }, requests: { invoiceId: string; amount: Paise }[]) {
  const available = paise(payment.amount as string) - paise(payment.allocatedAmount as string);
  const targets = await openTargets(tx, payment.direction, payment.counterpartyId);
  validateAllocations(available, requests, targets);
  for (const r of requests) {
    await tx.paymentAllocation.create({
      data: { businessId: ctx.businessId, paymentId: payment.id, invoiceId: r.invoiceId, amount: dec(r.amount), createdById: ctx.userId },
    });
  }
}

export async function recordPaymentTx(tx: Tx, ctx: Pick<TenantContext, "businessId" | "userId" | "permissions" | "today" | "timezone">, raw: PaymentInput, opts: { importBatchId?: string } = {}) {
  assertCan(ctx, "payments.record");
  const input = paymentInputSchema.parse(raw);
  assertCan(ctx, input.direction === "received" ? "receivables.view" : "payables.view");
  if (input.paymentDate > ctx.today) {
    throw new AppError(
      input.direction === "made" ? "A payment cannot be dated in the future. Use “Schedule payment” to plan it." : "A payment cannot be dated in the future.",
      { paymentDate: "Date is in the future" },
    );
  }
  const cp = await requireCounterparty(tx, input.counterpartyId, input.direction === "received" ? "customer" : "supplier");
  const { settings } = await loadSettings(tx, ctx.businessId);
  if (settings.paymentMethods.length > 0 && !settings.paymentMethods.includes(input.method)) {
    throw new AppError("Choose one of the configured payment methods", { method: "Unknown payment method" });
  }

  const payment = await tx.payment.create({
    data: {
      businessId: ctx.businessId,
      direction: input.direction,
      counterpartyId: cp.id,
      amount: dec(input.amount),
      paymentDate: toDbDate(input.paymentDate),
      method: input.method,
      reference: input.reference,
      notes: input.notes,
      importBatchId: opts.importBatchId ?? null,
      createdById: ctx.userId,
    },
  });
  await applyAllocations(tx, ctx, payment, input.allocations);
  const allocated = input.allocations.reduce((a, r) => a + r.amount, 0n);

  await audit(tx, {
    businessId: ctx.businessId,
    actorUserId: ctx.userId,
    action: input.direction === "received" ? "payment.received" : "payment.made",
    entityType: "payment",
    entityId: payment.id,
    summary: `${formatINR(input.amount)} ${input.direction === "received" ? "received from" : "paid to"} ${cp.name} (${input.method}${input.reference ? `, ref ${input.reference}` : ""})${allocated < input.amount ? ` — ${formatINR(input.amount - allocated)} unallocated` : ""}`,
    after: { amount: input.amount, paymentDate: input.paymentDate, allocations: input.allocations },
  });
  await afterBalanceChange(tx, ctx, cp.id, input.allocations.map((a) => a.invoiceId));
  return payment;
}

export async function recordPayment(ctx: TenantContext, raw: PaymentInput) {
  return withTenant(ctx.businessId, (tx) => recordPaymentTx(tx, ctx, raw));
}

/** Allocates part of a payment's unallocated balance. */
export async function allocatePayment(ctx: TenantContext, paymentId: string, requests: { invoiceId: string; amount: string }[]) {
  assertCan(ctx, "payments.record");
  const parsed = requests.filter((r) => r.amount && r.amount.trim() !== "" && r.amount.trim() !== "0").map((r) => ({ invoiceId: r.invoiceId, amount: parseAmount(r.amount) }));
  if (parsed.length === 0) throw new AppError("Enter at least one allocation amount.");
  return withTenant(ctx.businessId, async (tx) => {
    const payment = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new NotFoundError("Payment");
    if (payment.status !== "active") throw new AppError("A reversed payment cannot be allocated.");
    await applyAllocations(tx, ctx, payment, parsed);
    await audit(tx, {
      businessId: ctx.businessId,
      actorUserId: ctx.userId,
      action: "allocation.created",
      entityType: "payment",
      entityId: paymentId,
      summary: `Allocated ${formatINR(parsed.reduce((a, r) => a + r.amount, 0n))} of payment`,
      after: { allocations: parsed },
    });
    await afterBalanceChange(tx, ctx, payment.counterpartyId, parsed.map((p) => p.invoiceId));
  });
}

export async function reverseAllocation(ctx: TenantContext, allocationId: string, reason: string) {
  assertCan(ctx, "payments.reverse");
  if (!reason || reason.trim().length < 3) throw new AppError("Give a reason for the reversal.", { reason: "Required" });
  return withTenant(ctx.businessId, async (tx) => {
    const alloc = await tx.paymentAllocation.findUnique({ where: { id: allocationId }, include: { payment: true, invoice: true } });
    if (!alloc) throw new NotFoundError("Allocation");
    if (alloc.status !== "active") throw new AppError("This allocation was already reversed.");
    await tx.paymentAllocation.update({
      where: { id: allocationId },
      data: { status: "reversed", reversedAt: new Date(), reversedById: ctx.userId, reversalReason: reason.trim() },
    });
    await audit(tx, {
      businessId: ctx.businessId,
      actorUserId: ctx.userId,
      action: "allocation.reversed",
      entityType: "invoice",
      entityId: alloc.invoiceId,
      summary: `Allocation of ${formatINR(paise(alloc.amount))} to ${alloc.invoice.invoiceNumber} reversed: ${reason.trim()}`,
      before: { allocationId, amount: alloc.amount, status: "active" },
      after: { status: "reversed", reason: reason.trim() },
    });
    await afterBalanceChange(tx, ctx, alloc.payment.counterpartyId, [alloc.invoiceId]);
  });
}

/** Moves an allocation to another open invoice of the same counterparty, keeping both records. */
export async function reallocate(ctx: TenantContext, allocationId: string, toInvoiceId: string, reason: string) {
  assertCan(ctx, "payments.reverse");
  assertCan(ctx, "payments.record");
  if (!reason || reason.trim().length < 3) throw new AppError("Give a reason for the reallocation.", { reason: "Required" });
  return withTenant(ctx.businessId, async (tx) => {
    const alloc = await tx.paymentAllocation.findUnique({ where: { id: allocationId }, include: { payment: true, invoice: true } });
    if (!alloc) throw new NotFoundError("Allocation");
    if (alloc.status !== "active") throw new AppError("This allocation was already reversed.");
    if (alloc.invoiceId === toInvoiceId) throw new AppError("Choose a different invoice.");
    await tx.paymentAllocation.update({
      where: { id: allocationId },
      data: { status: "reversed", reversedAt: new Date(), reversedById: ctx.userId, reversalReason: `Reallocated: ${reason.trim()}` },
    });
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: alloc.paymentId } });
    await applyAllocations(tx, ctx, payment, [{ invoiceId: toInvoiceId, amount: paise(alloc.amount) }]);
    const target = await tx.invoice.findUniqueOrThrow({ where: { id: toInvoiceId }, select: { invoiceNumber: true } });
    await audit(tx, {
      businessId: ctx.businessId,
      actorUserId: ctx.userId,
      action: "allocation.reallocated",
      entityType: "payment",
      entityId: alloc.paymentId,
      summary: `${formatINR(paise(alloc.amount))} moved from ${alloc.invoice.invoiceNumber} to ${target.invoiceNumber}: ${reason.trim()}`,
      before: { invoiceId: alloc.invoiceId },
      after: { invoiceId: toInvoiceId },
    });
    await afterBalanceChange(tx, ctx, alloc.payment.counterpartyId, [alloc.invoiceId, toInvoiceId]);
  });
}

/** Reverses a payment and all its active allocations. The records remain, marked reversed. */
export async function reversePayment(ctx: TenantContext, paymentId: string, reason: string) {
  assertCan(ctx, "payments.reverse");
  if (!reason || reason.trim().length < 3) throw new AppError("Give a reason for the reversal.", { reason: "Required" });
  return withTenant(ctx.businessId, async (tx) => {
    const payment = await tx.payment.findUnique({ where: { id: paymentId }, include: { allocations: { where: { status: "active" } } } });
    if (!payment) throw new NotFoundError("Payment");
    if (payment.status !== "active") throw new AppError("This payment was already reversed.");
    const now = new Date();
    for (const a of payment.allocations) {
      await tx.paymentAllocation.update({
        where: { id: a.id },
        data: { status: "reversed", reversedAt: now, reversedById: ctx.userId, reversalReason: `Payment reversed: ${reason.trim()}` },
      });
    }
    await tx.payment.update({
      where: { id: paymentId },
      data: { status: "reversed", reversedAt: now, reversedById: ctx.userId, reversalReason: reason.trim() },
    });
    await audit(tx, {
      businessId: ctx.businessId,
      actorUserId: ctx.userId,
      action: "payment.reversed",
      entityType: "payment",
      entityId: paymentId,
      summary: `Payment of ${formatINR(paise(payment.amount))} reversed: ${reason.trim()}`,
      before: { status: "active", allocations: payment.allocations.map((a) => ({ invoiceId: a.invoiceId, amount: a.amount })) },
      after: { status: "reversed", reason: reason.trim() },
    });
    await afterBalanceChange(tx, ctx, payment.counterpartyId, payment.allocations.map((a) => a.invoiceId));
  });
}

export const adjustmentSchema = z.object({
  kind: z.enum(["credit_note", "write_off"]),
  amount: z.string(),
  adjustmentDate: z.string().refine(isISODate, "Enter a valid date"),
  reference: z.string().max(80).optional(),
  reason: z.string().trim().min(3, "Give a reason").max(500),
});

export async function addAdjustment(ctx: TenantContext, invoiceId: string, raw: z.input<typeof adjustmentSchema>) {
  assertCan(ctx, "payments.reverse");
  const input = adjustmentSchema.parse(raw);
  const amount = parseAmount(input.amount);
  if (amount <= 0n) throw new AppError("Amount must be greater than zero", { amount: "Must be positive" });
  return withTenant(ctx.businessId, async (tx) => {
    const inv = await tx.invoice.findUnique({ where: { id: invoiceId } });
    if (!inv) throw new NotFoundError("Invoice");
    if (inv.lifecycle !== "open") throw new AppError("Adjustments can only be made to open invoices.");
    if (amount > paise(inv.outstandingAmount)) throw new AppError("The adjustment exceeds the outstanding balance.", { amount: "Exceeds outstanding" });
    const adj = await tx.adjustment.create({
      data: {
        businessId: ctx.businessId,
        invoiceId,
        kind: input.kind,
        amount: dec(amount),
        adjustmentDate: toDbDate(input.adjustmentDate),
        reference: input.reference?.trim() || null,
        reason: input.reason,
        createdById: ctx.userId,
      },
    });
    await audit(tx, {
      businessId: ctx.businessId,
      actorUserId: ctx.userId,
      action: `adjustment.${input.kind}`,
      entityType: "invoice",
      entityId: invoiceId,
      summary: `${input.kind === "credit_note" ? "Credit note" : "Write-off"} of ${formatINR(amount)} on ${inv.invoiceNumber}: ${input.reason}`,
      after: { adjustmentId: adj.id, amount, reason: input.reason },
    });
    await afterBalanceChange(tx, ctx, inv.counterpartyId, [invoiceId]);
  });
}

export async function reverseAdjustment(ctx: TenantContext, adjustmentId: string, reason: string) {
  assertCan(ctx, "payments.reverse");
  if (!reason || reason.trim().length < 3) throw new AppError("Give a reason for the reversal.", { reason: "Required" });
  return withTenant(ctx.businessId, async (tx) => {
    const adj = await tx.adjustment.findUnique({ where: { id: adjustmentId }, include: { invoice: true } });
    if (!adj) throw new NotFoundError("Adjustment");
    if (adj.status !== "active") throw new AppError("Already reversed.");
    await tx.adjustment.update({ where: { id: adjustmentId }, data: { status: "reversed", reversedAt: new Date(), reversedById: ctx.userId, reversalReason: reason.trim() } });
    await audit(tx, {
      businessId: ctx.businessId,
      actorUserId: ctx.userId,
      action: "adjustment.reversed",
      entityType: "invoice",
      entityId: adj.invoiceId,
      summary: `Adjustment of ${formatINR(paise(adj.amount))} reversed: ${reason.trim()}`,
    });
    await afterBalanceChange(tx, ctx, adj.invoice.counterpartyId, [adj.invoiceId]);
  });
}
