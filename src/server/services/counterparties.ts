import "server-only";
import { z } from "zod";
import { withTenant, type Tx } from "../db";
import { assertCan, type TenantContext } from "../authz";
import { AppError, NotFoundError } from "../errors";
import { audit, diff } from "../audit";
import { dec } from "./common";
import { parseAmount } from "@/domain/money";

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const optText = (max = 300) => z.string().max(max).optional().transform((v) => (v && v.trim() !== "" ? v.trim() : null));
const optDays = z
  .string()
  .optional()
  .transform((v, c) => {
    if (!v || v.trim() === "") return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 365) {
      c.addIssue({ code: "custom", message: "Enter 0–365 days" });
      return z.NEVER;
    }
    return n;
  });

export const counterpartySchema = z
  .object({
    name: z.string().trim().min(2, "Business name is required").max(200),
    contactPerson: optText(120),
    phone: z
      .string()
      .optional()
      .transform((v, c) => {
        if (!v || v.trim() === "") return null;
        const t = v.trim();
        if (!/^[+\d][\d\s-]{6,19}$/.test(t)) {
          c.addIssue({ code: "custom", message: "Enter a valid phone number" });
          return z.NEVER;
        }
        return t;
      }),
    email: z
      .string()
      .optional()
      .transform((v, c) => {
        if (!v || v.trim() === "") return null;
        const t = v.trim().toLowerCase();
        if (!z.email().safeParse(t).success) {
          c.addIssue({ code: "custom", message: "Enter a valid email" });
          return z.NEVER;
        }
        return t;
      }),
    billingAddress: optText(500),
    gstin: z
      .string()
      .optional()
      .transform((v, c) => {
        if (!v || v.trim() === "") return null;
        const t = v.trim().toUpperCase();
        if (!GSTIN_RE.test(t)) {
          c.addIssue({ code: "custom", message: "GSTIN format looks wrong (15 characters, e.g. 36AABCU9603R1ZM)" });
          return z.NEVER;
        }
        return t;
      }),
    accountCode: optText(40),
    isCustomer: z.string().optional().transform((v) => v === "on" || v === "true"),
    isSupplier: z.string().optional().transform((v) => v === "on" || v === "true"),
    customerCreditDays: optDays,
    supplierCreditDays: optDays,
    paymentTerms: optText(120),
    creditLimit: z
      .string()
      .optional()
      .transform((v, c) => {
        if (!v || v.trim() === "") return null;
        try {
          const p = parseAmount(v);
          if (p < 0n) throw new Error();
          return p;
        } catch {
          c.addIssue({ code: "custom", message: "Enter a valid amount" });
          return z.NEVER;
        }
      }),
    status: z.enum(["active", "on_hold", "inactive"]).default("active"),
    assignedUserId: z.string().optional().transform((v) => (v && v !== "" ? v : null)),
    notes: optText(2000),
  })
  .refine((v) => v.isCustomer || v.isSupplier, { path: ["isCustomer"], message: "Mark the account as a customer, a supplier, or both" });

export type CounterpartyInput = z.input<typeof counterpartySchema>;

function permissionFor(v: { isCustomer: boolean; isSupplier: boolean }) {
  return { customer: v.isCustomer, supplier: v.isSupplier };
}

function assertCanManage(ctx: Pick<TenantContext, "permissions">, v: { isCustomer: boolean; isSupplier: boolean }) {
  const p = permissionFor(v);
  if (p.customer) assertCan(ctx, "receivables.manage");
  if (p.supplier) assertCan(ctx, "payables.manage");
}

export async function createCounterpartyTx(tx: Tx, ctx: Pick<TenantContext, "businessId" | "userId" | "permissions">, raw: CounterpartyInput, opts: { importBatchId?: string } = {}) {
  const input = counterpartySchema.parse(raw);
  assertCanManage(ctx, input);
  if (input.accountCode) {
    const exists = await tx.counterparty.findFirst({ where: { accountCode: input.accountCode } });
    if (exists) throw new AppError("Account code is already used", { accountCode: `Used by ${exists.name}` });
  }
  if (input.assignedUserId) {
    const m = await tx.membership.findFirst({ where: { businessId: ctx.businessId, userId: input.assignedUserId, status: "active" } });
    if (!m) throw new AppError("Assigned employee is not a member", { assignedUserId: "Select a team member" });
  }
  const cp = await tx.counterparty.create({
    data: {
      businessId: ctx.businessId,
      ...input,
      creditLimit: input.creditLimit !== null ? dec(input.creditLimit) : null,
      importBatchId: opts.importBatchId ?? null,
    },
  });
  await audit(tx, {
    businessId: ctx.businessId,
    actorUserId: ctx.userId,
    action: "counterparty.created",
    entityType: "counterparty",
    entityId: cp.id,
    summary: `${cp.name} added as ${[cp.isCustomer && "customer", cp.isSupplier && "supplier"].filter(Boolean).join(" and ")}`,
  });
  return cp;
}

export async function createCounterparty(ctx: TenantContext, raw: CounterpartyInput) {
  return withTenant(ctx.businessId, (tx) => createCounterpartyTx(tx, ctx, raw));
}

export async function updateCounterparty(ctx: TenantContext, id: string, raw: CounterpartyInput) {
  const input = counterpartySchema.parse(raw);
  return withTenant(ctx.businessId, async (tx) => {
    const cp = await tx.counterparty.findUnique({ where: { id } });
    if (!cp) throw new NotFoundError("Account");
    assertCanManage(ctx, { isCustomer: cp.isCustomer || input.isCustomer, isSupplier: cp.isSupplier || input.isSupplier });
    if (cp.isCustomer && !input.isCustomer && (await tx.invoice.count({ where: { counterpartyId: id, direction: "receivable" } })) > 0) {
      throw new AppError("This account has receivable invoices, so it must stay a customer.", { isCustomer: "Has invoices" });
    }
    if (cp.isSupplier && !input.isSupplier && (await tx.invoice.count({ where: { counterpartyId: id, direction: "payable" } })) > 0) {
      throw new AppError("This account has supplier bills, so it must stay a supplier.", { isSupplier: "Has bills" });
    }
    if (input.accountCode && input.accountCode !== cp.accountCode) {
      const exists = await tx.counterparty.findFirst({ where: { accountCode: input.accountCode, id: { not: id } } });
      if (exists) throw new AppError("Account code is already used", { accountCode: `Used by ${exists.name}` });
    }
    const data = { ...input, creditLimit: input.creditLimit !== null ? dec(input.creditLimit) : null };
    await tx.counterparty.update({ where: { id }, data });
    const d = diff(cp as unknown as Record<string, unknown>, data as unknown as Record<string, unknown>);
    if (d.changed.length) {
      await audit(tx, {
        businessId: ctx.businessId,
        actorUserId: ctx.userId,
        action: "counterparty.updated",
        entityType: "counterparty",
        entityId: id,
        summary: `${cp.name}: updated ${d.changed.join(", ")}`,
        before: d.before,
        after: d.after,
      });
    }
  });
}
