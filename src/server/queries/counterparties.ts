import "server-only";
import type { Prisma } from "@prisma/client";
import { withTenant } from "../db";
import { assertCan, type TenantContext } from "../context";
import { NotFoundError } from "../errors";
import { paise } from "../services/common";
import { fromDbDate, toDbDate } from "@/domain/dates";

export async function listCounterparties(ctx: TenantContext, kind: "customer" | "supplier", p: { q?: string; status?: string; assignee?: string; page?: number; sort?: string }) {
  assertCan(ctx, kind === "customer" ? "receivables.view" : "payables.view");
  const direction = kind === "customer" ? "receivable" : "payable";
  const where: Prisma.CounterpartyWhereInput = {
    ...(kind === "customer" ? { isCustomer: true } : { isSupplier: true }),
    ...(p.status && ["active", "on_hold", "inactive"].includes(p.status) ? { status: p.status as never } : {}),
    ...(p.assignee === "unassigned" ? { assignedUserId: null } : p.assignee ? { assignedUserId: p.assignee } : {}),
    ...(p.q?.trim()
      ? { OR: [{ name: { contains: p.q.trim(), mode: "insensitive" } }, { accountCode: { contains: p.q.trim(), mode: "insensitive" } }, { gstin: { contains: p.q.trim(), mode: "insensitive" } }, { phone: { contains: p.q.trim() } }, { contactPerson: { contains: p.q.trim(), mode: "insensitive" } }] }
      : {}),
  };
  const pageSize = 25;
  const page = Math.max(p.page ?? 1, 1);
  return withTenant(ctx.businessId, async (tx) => {
    const t = toDbDate(ctx.today);
    const total = await tx.counterparty.count({ where });
    // Balance-based sorts need all rows; directories are hundreds of rows at most.
    const all = await tx.counterparty.findMany({
      where,
      orderBy: { name: "asc" },
      include: { invoices: { where: { direction, lifecycle: "open", outstandingAmount: { gt: 0 } }, select: { outstandingAmount: true, dueDate: true } } },
    });
    const users = await tx.user.findMany({ where: { id: { in: [...new Set(all.map((c) => c.assignedUserId).filter(Boolean))] as string[] } }, select: { id: true, name: true } });
    const rows = all.map((c) => {
      const outstanding = c.invoices.reduce((a, i) => a + paise(i.outstandingAmount), 0n);
      const overdue = c.invoices.filter((i) => i.dueDate < t).reduce((a, i) => a + paise(i.outstandingAmount), 0n);
      return { ...c, outstanding, overdue, openCount: c.invoices.length, assigneeName: users.find((u) => u.id === c.assignedUserId)?.name ?? null, creditLimitP: c.creditLimit !== null ? paise(c.creditLimit) : null };
    });
    const cmp = (a: bigint, b: bigint) => (a > b ? -1 : a < b ? 1 : 0);
    if (p.sort === "outstanding") rows.sort((a, b) => cmp(a.outstanding, b.outstanding));
    else if (p.sort === "overdue") rows.sort((a, b) => cmp(a.overdue, b.overdue));
    return { total, page, pageSize, rows: rows.slice((page - 1) * pageSize, page * pageSize) };
  });
}

export async function getCounterpartyProfile(ctx: TenantContext, id: string) {
  return withTenant(ctx.businessId, async (tx) => {
    const cp = await tx.counterparty.findUnique({ where: { id } });
    if (!cp) throw new NotFoundError("Account");
    const canR = ctx.permissions.has("receivables.view") && cp.isCustomer;
    const canP = ctx.permissions.has("payables.view") && cp.isSupplier;
    if (!canR && !canP) throw new NotFoundError("Account");
    const directions = [...(canR ? ["receivable" as const] : []), ...(canP ? ["payable" as const] : [])];
    const [invoices, payments, comms, followUps, promises, disputes, documents, messages, planned] = await Promise.all([
      tx.invoice.findMany({ where: { counterpartyId: id, direction: { in: directions } }, orderBy: [{ dueDate: "asc" }], include: { disputes: { where: { status: { notIn: ["resolved", "closed"] } }, select: { id: true } } } }),
      tx.payment.findMany({ where: { counterpartyId: id, direction: { in: [...(canR ? ["received" as const] : []), ...(canP ? ["made" as const] : [])] } }, orderBy: { paymentDate: "desc" }, take: 50, include: { allocations: { where: { status: "active" }, include: { invoice: { select: { invoiceNumber: true } } } } } }),
      tx.communication.findMany({ where: { counterpartyId: id }, orderBy: { contactedAt: "desc" }, take: 50, include: { invoices: { include: { invoice: { select: { invoiceNumber: true, id: true } } } } } }),
      tx.followUp.findMany({ where: { counterpartyId: id }, orderBy: [{ status: "asc" }, { dueDate: "asc" }], take: 50 }),
      canR ? tx.paymentPromise.findMany({ where: { counterpartyId: id }, orderBy: { promisedDate: "desc" }, include: { invoices: { include: { invoice: { select: { invoiceNumber: true } } } } } }) : Promise.resolve([]),
      tx.dispute.findMany({ where: { counterpartyId: id, invoice: { direction: { in: directions } } }, orderBy: { raisedOn: "desc" }, include: { invoice: { select: { invoiceNumber: true, id: true, direction: true } } } }),
      tx.document.findMany({ where: { deletedAt: null, OR: [{ counterpartyId: id }, { invoice: { counterpartyId: id } }] }, orderBy: { createdAt: "desc" }, take: 50, include: { invoice: { select: { invoiceNumber: true } } } }),
      tx.messageLog.findMany({ where: { counterpartyId: id }, orderBy: { createdAt: "desc" }, take: 20 }),
      canP ? tx.plannedPayment.findMany({ where: { invoice: { counterpartyId: id }, status: "scheduled" }, orderBy: { plannedDate: "asc" }, include: { invoice: { select: { invoiceNumber: true, id: true } } } }) : Promise.resolve([]),
    ]);
    const timelineAudit = await tx.auditLog.findMany({
      where: { OR: [{ entityType: "counterparty", entityId: id }, { entityType: "invoice", entityId: { in: invoices.map((i) => i.id) } }, { entityType: "payment", entityId: { in: payments.map((p) => p.id) } }] },
      orderBy: { createdAt: "desc" },
      take: 80,
    });
    const userIds = new Set<string>();
    for (const x of [...comms.map((c) => c.createdById), ...followUps.map((f) => f.assignedUserId), ...timelineAudit.map((a) => a.actorUserId), cp.assignedUserId]) if (x) userIds.add(x);
    const users = await tx.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, name: true } });
    const t = ctx.today;
    const open = invoices.filter((i) => i.lifecycle === "open" && paise(i.outstandingAmount) > 0n);
    const sum = (dir: "receivable" | "payable", overdueOnly = false) =>
      open.filter((i) => i.direction === dir && (!overdueOnly || fromDbDate(i.dueDate) < t)).reduce((a, i) => a + paise(i.outstandingAmount), 0n);
    return {
      cp,
      canR,
      canP,
      invoices,
      payments,
      comms,
      followUps,
      promises,
      disputes,
      documents,
      messages,
      planned,
      timelineAudit,
      totals: {
        receivable: sum("receivable"),
        receivableOverdue: sum("receivable", true),
        payable: sum("payable"),
        payableOverdue: sum("payable", true),
        unallocatedReceived: payments.filter((p) => p.direction === "received" && p.status === "active").reduce((a, p) => a + paise(p.amount) - paise(p.allocatedAmount), 0n),
        unallocatedMade: payments.filter((p) => p.direction === "made" && p.status === "active").reduce((a, p) => a + paise(p.amount) - paise(p.allocatedAmount), 0n),
      },
      userName: (uid: string | null | undefined) => (uid ? users.find((u) => u.id === uid)?.name ?? "Former member" : "System"),
    };
  });
}

export async function counterpartyOptions(ctx: TenantContext, kind: "customer" | "supplier") {
  return withTenant(ctx.businessId, (tx) =>
    tx.counterparty.findMany({
      where: { ...(kind === "customer" ? { isCustomer: true } : { isSupplier: true }), status: { not: "inactive" } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, customerCreditDays: true, supplierCreditDays: true, paymentTerms: true, assignedUserId: true },
    }),
  );
}

export async function memberOptions(ctx: TenantContext) {
  return withTenant(ctx.businessId, async (tx) => {
    const m = await tx.membership.findMany({ where: { businessId: ctx.businessId, status: "active" }, include: { user: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } });
    return m.map((x) => ({ id: x.user.id, name: x.user.name, role: x.role }));
  });
}
