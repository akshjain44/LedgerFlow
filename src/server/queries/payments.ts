import "server-only";
import type { Prisma } from "@prisma/client";
import { withTenant } from "../db";
import { assertCan, type TenantContext } from "../authz";
import { NotFoundError } from "../errors";
import { paise } from "../services/common";
import { isISODate, toDbDate } from "@/domain/dates";

export async function listPayments(ctx: TenantContext, p: { direction?: string; q?: string; from?: string; to?: string; status?: string; method?: string; unallocated?: string; page?: number }) {
  const directions: ("received" | "made")[] = [];
  if (ctx.permissions.has("receivables.view") && p.direction !== "made") directions.push("received");
  if (ctx.permissions.has("payables.view") && p.direction !== "received") directions.push("made");
  const where: Prisma.PaymentWhereInput = {
    direction: { in: directions },
    ...(p.status === "reversed" ? { status: "reversed" } : p.status === "all" ? {} : { status: "active" }),
    ...(p.method ? { method: p.method } : {}),
    ...(isISODate(p.from) || isISODate(p.to) ? { paymentDate: { ...(isISODate(p.from) ? { gte: toDbDate(p.from) } : {}), ...(isISODate(p.to) ? { lte: toDbDate(p.to) } : {}) } } : {}),
    ...(p.q?.trim() ? { OR: [{ reference: { contains: p.q.trim(), mode: "insensitive" } }, { counterparty: { name: { contains: p.q.trim(), mode: "insensitive" } } }] } : {}),
  };
  const pageSize = 25;
  const page = Math.max(p.page ?? 1, 1);
  return withTenant(ctx.businessId, async (tx) => {
    const all = await tx.payment.findMany({
      where,
      orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
      include: { counterparty: { select: { id: true, name: true } }, allocations: { where: { status: "active" }, include: { invoice: { select: { id: true, invoiceNumber: true } } } } },
    });
    const filtered = p.unallocated === "1" ? all.filter((x) => x.status === "active" && paise(x.amount) > paise(x.allocatedAmount)) : all;
    const users = await tx.user.findMany({ where: { id: { in: [...new Set(filtered.map((x) => x.createdById).filter(Boolean))] as string[] } }, select: { id: true, name: true } });
    const totals = { received: 0n, made: 0n };
    for (const x of filtered) if (x.status === "active") totals[x.direction] += paise(x.amount);
    return {
      total: filtered.length,
      page,
      pageSize,
      totals,
      rows: filtered.slice((page - 1) * pageSize, page * pageSize).map((x) => ({ ...x, createdByName: users.find((u) => u.id === x.createdById)?.name ?? "—" })),
    };
  });
}

export async function getPayment(ctx: TenantContext, id: string) {
  return withTenant(ctx.businessId, async (tx) => {
    const p = await tx.payment.findUnique({
      where: { id },
      include: {
        counterparty: true,
        allocations: { orderBy: { createdAt: "asc" }, include: { invoice: { select: { id: true, invoiceNumber: true, direction: true, dueDate: true, outstandingAmount: true } } } },
        documents: { where: { deletedAt: null } },
      },
    });
    if (!p) throw new NotFoundError("Payment");
    assertCan(ctx, p.direction === "received" ? "receivables.view" : "payables.view");
    const audit = await tx.auditLog.findMany({ where: { entityType: "payment", entityId: id }, orderBy: { createdAt: "desc" } });
    const ids = new Set<string>([p.createdById, p.reversedById, ...p.allocations.flatMap((a) => [a.createdById, a.reversedById]), ...audit.map((a) => a.actorUserId)].filter(Boolean) as string[]);
    const users = await tx.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true } });
    return { p, audit, userName: (uid: string | null | undefined) => (uid ? users.find((u) => u.id === uid)?.name ?? "Former member" : "System") };
  });
}

export async function globalSearch(ctx: TenantContext, q: string) {
  const term = q.trim();
  if (term.length < 2) return { counterparties: [], invoices: [], payments: [] };
  return withTenant(ctx.businessId, async (tx) => {
    const canR = ctx.permissions.has("receivables.view");
    const canP = ctx.permissions.has("payables.view");
    const cpWhere: Prisma.CounterpartyWhereInput = {
      OR: [{ name: { contains: term, mode: "insensitive" } }, { accountCode: { contains: term, mode: "insensitive" } }, { gstin: { contains: term, mode: "insensitive" } }, { phone: { contains: term } }, { contactPerson: { contains: term, mode: "insensitive" } }],
      AND: [{ OR: [...(canR ? [{ isCustomer: true }] : []), ...(canP ? [{ isSupplier: true }] : [])] }],
    };
    const dirs = [...(canR ? ["receivable" as const] : []), ...(canP ? ["payable" as const] : [])];
    const [counterparties, invoices, payments] = await Promise.all([
      tx.counterparty.findMany({ where: cpWhere, take: 10, orderBy: { name: "asc" } }),
      tx.invoice.findMany({
        where: { direction: { in: dirs }, OR: [{ invoiceNumber: { contains: term, mode: "insensitive" } }, { poReference: { contains: term, mode: "insensitive" } }, { deliveryReference: { contains: term, mode: "insensitive" } }] },
        take: 15,
        include: { counterparty: { select: { name: true } } },
      }),
      tx.payment.findMany({
        where: { direction: { in: [...(canR ? ["received" as const] : []), ...(canP ? ["made" as const] : [])] }, reference: { contains: term, mode: "insensitive" } },
        take: 10,
        include: { counterparty: { select: { name: true } } },
      }),
    ]);
    return { counterparties, invoices, payments };
  });
}
