import "server-only";
import type { InvoiceDirection, Prisma } from "@prisma/client";
import { withTenant } from "../db";
import { assertCan, type TenantContext } from "../authz";
import { NotFoundError } from "../errors";
import { paise } from "../services/common";
import { addDays, diffDays, fromDbDate, toDbDate } from "@/domain/dates";
import { displayStatus, settlement } from "@/domain/invoiceStatus";
import { parseAmount, toDecimalString, type Paise } from "@/domain/money";

export const INVOICE_FILTERS = {
  receivable: [
    { key: "all", label: "All" },
    { key: "open", label: "Open" },
    { key: "not_due", label: "Not yet due" },
    { key: "due_today", label: "Due today" },
    { key: "overdue", label: "Overdue" },
    { key: "partially_paid", label: "Partially paid" },
    { key: "paid", label: "Fully paid" },
    { key: "disputed", label: "Disputed" },
    { key: "promise_due", label: "Promise due" },
    { key: "broken_promise", label: "Broken promise" },
    { key: "draft", label: "Draft" },
    { key: "void", label: "Void" },
  ],
  payable: [
    { key: "all", label: "All" },
    { key: "open", label: "Open" },
    { key: "not_due", label: "Not yet due" },
    { key: "due_today", label: "Due today" },
    { key: "overdue", label: "Overdue" },
    { key: "partially_paid", label: "Partially paid" },
    { key: "paid", label: "Fully paid" },
    { key: "disputed", label: "Disputed" },
    { key: "planned", label: "Payment planned" },
    { key: "void", label: "Void" },
  ],
} as const;

export const AGEING_FILTERS = [
  { key: "", label: "Any age" },
  { key: "d1_30", label: "1–30 days overdue" },
  { key: "d31_60", label: "31–60 days overdue" },
  { key: "d61_90", label: "61–90 days overdue" },
  { key: "d90_plus", label: "90+ days overdue" },
];

export interface InvoiceListParams {
  q?: string;
  filter?: string;
  counterpartyId?: string;
  assignee?: string;
  bucket?: string;
  min?: string;
  max?: string;
  priority?: string;
  sort?: string;
  dir?: string;
  page?: number;
  pageSize?: number;
}

const OPEN_WITH_BALANCE: Prisma.InvoiceWhereInput = { lifecycle: "open", outstandingAmount: { gt: 0 } };

export function invoiceWhere(direction: InvoiceDirection, p: InvoiceListParams, today: string): Prisma.InvoiceWhereInput {
  const and: Prisma.InvoiceWhereInput[] = [{ direction }];
  const t = toDbDate(today);
  switch (p.filter) {
    case "open": and.push(OPEN_WITH_BALANCE); break;
    case "not_due": and.push(OPEN_WITH_BALANCE, { dueDate: { gt: t } }); break;
    case "due_today": and.push(OPEN_WITH_BALANCE, { dueDate: t }); break;
    case "overdue": and.push(OPEN_WITH_BALANCE, { dueDate: { lt: t } }); break;
    case "partially_paid": and.push(OPEN_WITH_BALANCE, { OR: [{ amountPaid: { gt: 0 } }, { amountAdjusted: { gt: 0 } }] }); break;
    case "paid": and.push({ lifecycle: "open", outstandingAmount: 0 }); break;
    case "disputed": and.push({ disputes: { some: { status: { notIn: ["resolved", "closed"] } } } }); break;
    case "promise_due": and.push(OPEN_WITH_BALANCE, { promiseLinks: { some: { promise: { status: "upcoming", promisedDate: { lte: t } } } } }); break;
    case "broken_promise": and.push(OPEN_WITH_BALANCE, { promiseLinks: { some: { promise: { status: "broken" } } } }); break;
    case "planned": and.push(OPEN_WITH_BALANCE, { plannedPayments: { some: { status: "scheduled" } } }); break;
    case "draft": and.push({ lifecycle: "draft" }); break;
    case "void": and.push({ lifecycle: "void" }); break;
    case "all": break;
    default: and.push({ lifecycle: { not: "void" } });
  }
  if (p.bucket) {
    const ranges: Record<string, [number, number | null]> = { d1_30: [1, 30], d31_60: [31, 60], d61_90: [61, 90], d90_plus: [91, null] };
    const r = ranges[p.bucket];
    if (r) {
      // days overdue in [lo, hi]  ⇔  due date in [today-hi, today-lo]
      and.push(OPEN_WITH_BALANCE, { dueDate: { lte: toDbDate(addDays(today, -r[0])), ...(r[1] !== null ? { gte: toDbDate(addDays(today, -r[1])) } : {}) } });
    }
  }
  if (p.counterpartyId) and.push({ counterpartyId: p.counterpartyId });
  if (p.assignee === "unassigned") and.push({ assignedUserId: null });
  else if (p.assignee) and.push({ assignedUserId: p.assignee });
  if (p.priority && ["low", "normal", "high", "critical"].includes(p.priority)) and.push({ priority: p.priority as never });
  const amount = (s?: string): Paise | null => {
    if (!s) return null;
    try { return parseAmount(s); } catch { return null; }
  };
  const min = amount(p.min);
  const max = amount(p.max);
  if (min !== null) and.push({ outstandingAmount: { gte: toDecimalString(min) } });
  if (max !== null) and.push({ outstandingAmount: { lte: toDecimalString(max) } });
  if (p.q && p.q.trim()) {
    const q = p.q.trim();
    and.push({
      OR: [
        { invoiceNumber: { contains: q, mode: "insensitive" } },
        { counterparty: { name: { contains: q, mode: "insensitive" } } },
        { poReference: { contains: q, mode: "insensitive" } },
        { deliveryReference: { contains: q, mode: "insensitive" } },
      ],
    });
  }
  return { AND: and };
}

const SORTS: Record<string, (dir: Prisma.SortOrder) => Prisma.InvoiceOrderByWithRelationInput[]> = {
  due: (d) => [{ dueDate: d }, { invoiceNumber: "asc" }],
  date: (d) => [{ invoiceDate: d }, { invoiceNumber: "asc" }],
  number: (d) => [{ invoiceNumber: d }],
  customer: (d) => [{ counterparty: { name: d } }, { dueDate: "asc" }],
  total: (d) => [{ totalAmount: d }],
  outstanding: (d) => [{ outstandingAmount: d }, { dueDate: "asc" }],
  priority: (d) => [{ priority: d === "asc" ? "desc" : "asc" }, { dueDate: "asc" }],
};

export async function listInvoices(ctx: TenantContext, direction: InvoiceDirection, p: InvoiceListParams) {
  assertCan(ctx, direction === "receivable" ? "receivables.view" : "payables.view");
  const pageSize = Math.min(Math.max(p.pageSize ?? 25, 10), 100);
  const page = Math.max(p.page ?? 1, 1);
  const dir: Prisma.SortOrder = p.dir === "desc" ? "desc" : "asc";
  const orderBy = (SORTS[p.sort ?? "due"] ?? SORTS.due)(dir);
  const where = invoiceWhere(direction, p, ctx.today);

  return withTenant(ctx.businessId, async (tx) => {
    const [total, rows, sums] = await Promise.all([
      tx.invoice.count({ where }),
      tx.invoice.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          counterparty: { select: { id: true, name: true, phone: true } },
          disputes: { where: { status: { notIn: ["resolved", "closed"] } }, select: { id: true, collectionHold: true } },
          followUps: { where: { status: "pending" }, orderBy: { dueDate: "asc" }, take: 1, select: { dueDate: true, title: true } },
          promiseLinks: { where: { promise: { status: { in: ["upcoming", "broken"] } } }, include: { promise: { select: { promisedDate: true, status: true, amount: true } } } },
          plannedPayments: { where: { status: "scheduled" }, orderBy: { plannedDate: "asc" }, take: 1, select: { plannedDate: true, amount: true } },
          communications: { orderBy: { communication: { contactedAt: "desc" } }, take: 1, include: { communication: { select: { contactedAt: true, outcome: true } } } },
        },
      }),
      tx.invoice.aggregate({ where, _sum: { outstandingAmount: true, totalAmount: true } }),
    ]);
    const memberIds = [...new Set(rows.map((r) => r.assignedUserId).filter(Boolean))] as string[];
    const users = memberIds.length ? await tx.user.findMany({ where: { id: { in: memberIds } }, select: { id: true, name: true } }) : [];
    const nameOf = new Map(users.map((u) => [u.id, u.name]));
    return {
      total,
      page,
      pageSize,
      sumOutstanding: paise(sums._sum.outstandingAmount),
      sumTotal: paise(sums._sum.totalAmount),
      rows: rows.map((r) => {
        const facts = { lifecycle: r.lifecycle, total: paise(r.totalAmount), paid: paise(r.amountPaid), adjusted: paise(r.amountAdjusted), dueDate: fromDbDate(r.dueDate) };
        const status = displayStatus(facts, ctx.today);
        const promise = r.promiseLinks.map((l) => l.promise).sort((a, b) => +b.promisedDate - +a.promisedDate)[0] ?? null;
        return {
          id: r.id,
          invoiceNumber: r.invoiceNumber,
          counterparty: r.counterparty,
          invoiceDate: fromDbDate(r.invoiceDate),
          dueDate: facts.dueDate,
          total: facts.total,
          paid: facts.paid + facts.adjusted,
          outstanding: paise(r.outstandingAmount),
          daysPastDue: status === "paid" || status === "void" || status === "draft" ? null : diffDays(facts.dueDate, ctx.today),
          status,
          settlement: settlement(facts),
          disputed: r.disputes.length > 0,
          onHold: r.disputes.some((d) => d.collectionHold),
          lastContact: r.communications[0]?.communication.contactedAt ?? null,
          nextAction: r.followUps[0] ? { date: fromDbDate(r.followUps[0].dueDate), title: r.followUps[0].title } : null,
          promise: promise ? { date: fromDbDate(promise.promisedDate), status: promise.status, amount: paise(promise.amount) } : null,
          plannedPayment: r.plannedPayments[0] ? { date: fromDbDate(r.plannedPayments[0].plannedDate), amount: paise(r.plannedPayments[0].amount) } : null,
          priority: r.priority,
          assignee: r.assignedUserId ? { id: r.assignedUserId, name: nameOf.get(r.assignedUserId) ?? "—" } : null,
        };
      }),
    };
  });
}

export type InvoiceListRow = Awaited<ReturnType<typeof listInvoices>>["rows"][number];

export async function getInvoiceDetail(ctx: TenantContext, id: string) {
  return withTenant(ctx.businessId, async (tx) => {
    const inv = await tx.invoice.findUnique({
      where: { id },
      include: {
        counterparty: true,
        allocations: { orderBy: { createdAt: "desc" }, include: { payment: true } },
        adjustments: { orderBy: { createdAt: "desc" } },
        followUps: { orderBy: [{ status: "asc" }, { dueDate: "asc" }] },
        communications: { include: { communication: true }, orderBy: { communication: { contactedAt: "desc" } } },
        promiseLinks: { include: { promise: { include: { invoices: { include: { invoice: { select: { invoiceNumber: true } } } } } } } },
        disputes: { orderBy: { createdAt: "desc" }, include: { updates: { orderBy: { createdAt: "asc" } } } },
        documents: { where: { deletedAt: null }, orderBy: { createdAt: "desc" } },
        plannedPayments: { orderBy: { plannedDate: "asc" } },
        reminderJobs: { orderBy: { scheduledFor: "asc" }, include: { deliveries: true } },
        messages: { orderBy: { createdAt: "desc" } },
      },
    });
    if (!inv) throw new NotFoundError("Invoice");
    assertCan(ctx, inv.direction === "receivable" ? "receivables.view" : "payables.view");
    const auditRows = await tx.auditLog.findMany({ where: { entityType: "invoice", entityId: id }, orderBy: { createdAt: "desc" }, take: 100 });
    const userIds = new Set<string>();
    for (const a of auditRows) if (a.actorUserId) userIds.add(a.actorUserId);
    for (const c of inv.communications) if (c.communication.createdById) userIds.add(c.communication.createdById);
    for (const a of inv.allocations) if (a.createdById) userIds.add(a.createdById);
    if (inv.assignedUserId) userIds.add(inv.assignedUserId);
    for (const f of inv.followUps) if (f.assignedUserId) userIds.add(f.assignedUserId);
    for (const r of inv.reminderJobs) for (const d of r.deliveries) userIds.add(d.recipientUserId);
    const users = await tx.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, name: true } });
    const facts = { lifecycle: inv.lifecycle, total: paise(inv.totalAmount), paid: paise(inv.amountPaid), adjusted: paise(inv.amountAdjusted), dueDate: fromDbDate(inv.dueDate) };
    return {
      inv,
      facts,
      status: displayStatus(facts, ctx.today),
      daysPastDue: diffDays(facts.dueDate, ctx.today),
      audit: auditRows,
      userName: (uid: string | null | undefined) => (uid ? users.find((u) => u.id === uid)?.name ?? "Former member" : "System"),
    };
  });
}

/** Open invoices of one counterparty, for allocation forms. */
export async function openInvoicesFor(ctx: TenantContext, counterpartyId: string, direction: InvoiceDirection) {
  return withTenant(ctx.businessId, async (tx) => {
    const rows = await tx.invoice.findMany({
      where: { counterpartyId, direction, lifecycle: "open", outstandingAmount: { gt: 0 } },
      orderBy: [{ dueDate: "asc" }, { invoiceNumber: "asc" }],
      select: { id: true, invoiceNumber: true, dueDate: true, outstandingAmount: true, totalAmount: true },
    });
    return rows.map((r) => ({ id: r.id, invoiceNumber: r.invoiceNumber, dueDate: fromDbDate(r.dueDate), outstanding: paise(r.outstandingAmount), total: paise(r.totalAmount) }));
  });
}
