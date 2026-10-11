import "server-only";
import { withTenant } from "../db";
import { assertCan, type TenantContext } from "../authz";
import { loadSettings, paise } from "../services/common";
import { addDays, diffDays, fromDbDate, todayIn, toDbDate } from "@/domain/dates";
import { scoreAccount, type PriorityResult } from "@/domain/priority";
import { tryParseAmount, type Paise } from "@/domain/money";

export interface QueueRow {
  counterpartyId: string;
  name: string;
  phone: string | null;
  contactPerson: string | null;
  assignedUserId: string | null;
  assigneeName: string | null;
  outstanding: Paise;
  overdue: Paise;
  maxDaysOverdue: number | null;
  invoiceCount: number;
  leadInvoice: { id: string; invoiceNumber: string; dueDate: string; outstanding: Paise; daysPastDue: number; poReference: string | null; deliveryReference: string | null } | null;
  lastContact: Date | null;
  lastOutcome: string | null;
  nextFollowUp: { id: string; date: string; title: string } | null;
  promise: { id: string; date: string; amount: Paise; status: string } | null;
  brokenPromises: number;
  openDisputes: number;
  onHold: boolean;
  priority: PriorityResult;
}

export interface QueueFilters {
  band?: string;
  minDays?: string;
  minAmount?: string;
  assignee?: string;
  counterpartyId?: string;
  promise?: string; // due_today | broken | none
  dispute?: string; // open | none
  contact?: string; // never | 7 | 14
  q?: string;
}

/**
 * The daily collections queue: every customer account needing attention today,
 * ranked by the transparent priority rules in src/domain/priority.ts.
 */
export async function collectionsQueue(ctx: TenantContext, f: QueueFilters = {}): Promise<QueueRow[]> {
  assertCan(ctx, "receivables.view");
  return withTenant(ctx.businessId, async (tx) => {
    const { business, settings, weights } = await loadSettings(tx, ctx.businessId);
    const today = ctx.today;
    const t = toDbDate(today);
    const windowStart = toDbDate(addDays(today, -settings.brokenPromiseWindowDays));

    const invoices = await tx.invoice.findMany({
      where: { direction: "receivable", lifecycle: "open", outstandingAmount: { gt: 0 } },
      select: { id: true, counterpartyId: true, invoiceNumber: true, dueDate: true, outstandingAmount: true, poReference: true, deliveryReference: true },
    });
    const cpIdsFromInvoices = new Set(invoices.map((i) => i.counterpartyId));
    const [followUps, promises, disputes] = await Promise.all([
      tx.followUp.findMany({ where: { status: "pending", counterparty: { isCustomer: true } }, orderBy: { dueDate: "asc" }, select: { id: true, counterpartyId: true, dueDate: true, title: true } }),
      tx.paymentPromise.findMany({ where: { status: { in: ["upcoming", "broken", "kept", "partially_kept"] }, promisedDate: { gte: windowStart } }, orderBy: { promisedDate: "desc" }, select: { id: true, counterpartyId: true, promisedDate: true, amount: true, status: true } }),
      tx.dispute.findMany({ where: { status: { notIn: ["resolved", "closed"] }, invoice: { direction: "receivable" } }, select: { counterpartyId: true, collectionHold: true } }),
    ]);
    const cpIds = new Set<string>([...cpIdsFromInvoices, ...followUps.map((x) => x.counterpartyId), ...promises.filter((p) => p.status === "upcoming").map((p) => p.counterpartyId)]);
    if (cpIds.size === 0) return [];
    const [cps, lastComms, payments] = await Promise.all([
      tx.counterparty.findMany({ where: { id: { in: [...cpIds] } }, select: { id: true, name: true, phone: true, contactPerson: true, assignedUserId: true } }),
      tx.communication.groupBy({ by: ["counterpartyId"], where: { counterpartyId: { in: [...cpIds] } }, _max: { contactedAt: true } }),
      tx.payment.groupBy({ by: ["counterpartyId"], where: { counterpartyId: { in: [...cpIds] }, direction: "received", status: "active" }, _max: { paymentDate: true } }),
    ]);
    const lastOutcomes = await tx.communication.findMany({
      where: { counterpartyId: { in: [...cpIds] } },
      orderBy: { contactedAt: "desc" },
      distinct: ["counterpartyId"],
      select: { counterpartyId: true, outcome: true },
    });
    const userIds = [...new Set(cps.map((c) => c.assignedUserId).filter(Boolean))] as string[];
    const users = await tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });

    const rows: QueueRow[] = [];
    for (const cp of cps) {
      const inv = invoices.filter((i) => i.counterpartyId === cp.id);
      let outstanding = 0n;
      let overdue = 0n;
      let maxDays: number | null = null;
      let overdueSince: string | null = null;
      let hasDueToday = false;
      let lead: QueueRow["leadInvoice"] = null;
      for (const i of inv) {
        const due = fromDbDate(i.dueDate);
        const amt = paise(i.outstandingAmount);
        const days = diffDays(due, today);
        outstanding += amt;
        if (days > 0) {
          overdue += amt;
          if (maxDays === null || days > maxDays) maxDays = days;
          const since = addDays(due, 1);
          if (overdueSince === null || since < overdueSince) overdueSince = since;
        }
        if (days === 0) hasDueToday = true;
        if (!lead || due < lead.dueDate) lead = { id: i.id, invoiceNumber: i.invoiceNumber, dueDate: due, outstanding: amt, daysPastDue: days, poReference: i.poReference, deliveryReference: i.deliveryReference };
      }
      const cpPromises = promises.filter((p) => p.counterpartyId === cp.id);
      const latestPromise = cpPromises[0] ?? null;
      const lastPayment = payments.find((p) => p.counterpartyId === cp.id)?._max.paymentDate ?? null;
      const unresolvedBroken =
        latestPromise?.status === "broken" && (!lastPayment || fromDbDate(lastPayment) <= fromDbDate(latestPromise.promisedDate));
      const promiseDueToday = cpPromises.some((p) => p.status === "upcoming" && fromDbDate(p.promisedDate) <= today);
      const brokenCount = cpPromises.filter((p) => p.status === "broken").length;
      const lastContactAt = lastComms.find((c) => c.counterpartyId === cp.id)?._max.contactedAt ?? null;
      const lastContactDate = lastContactAt ? todayIn(business.timezone, lastContactAt) : null;
      const fu = followUps.find((x) => x.counterpartyId === cp.id) ?? null;
      const cpDisputes = disputes.filter((d) => d.counterpartyId === cp.id);
      const onHold = settings.disputePolicy === "hold" ? cpDisputes.length > 0 : cpDisputes.some((d) => d.collectionHold);

      const needsAttention =
        overdue > 0n || hasDueToday || promiseDueToday || unresolvedBroken || (fu !== null && fromDbDate(fu.dueDate) <= today);
      if (!needsAttention) continue;

      const priority = scoreAccount(
        {
          today,
          maxDaysOverdue: maxDays,
          overdueAmount: overdue,
          outstanding,
          hasDueToday,
          promiseDueToday,
          unresolvedBrokenPromise: unresolvedBroken,
          brokenPromisesInWindow: brokenCount,
          lastContactDate,
          overdueSince,
          openDispute: cpDisputes.length > 0,
          disputeHold: onHold,
          nextFollowUpDate: fu ? fromDbDate(fu.dueDate) : null,
        },
        weights,
      );
      const shownPromise = cpPromises.find((p) => p.status === "upcoming") ?? latestPromise;
      rows.push({
        counterpartyId: cp.id,
        name: cp.name,
        phone: cp.phone,
        contactPerson: cp.contactPerson,
        assignedUserId: cp.assignedUserId,
        assigneeName: users.find((u) => u.id === cp.assignedUserId)?.name ?? null,
        outstanding,
        overdue,
        maxDaysOverdue: maxDays,
        invoiceCount: inv.length,
        leadInvoice: lead,
        lastContact: lastContactAt,
        lastOutcome: lastOutcomes.find((c) => c.counterpartyId === cp.id)?.outcome ?? null,
        nextFollowUp: fu ? { id: fu.id, date: fromDbDate(fu.dueDate), title: fu.title } : null,
        promise: shownPromise ? { id: shownPromise.id, date: fromDbDate(shownPromise.promisedDate), amount: paise(shownPromise.amount), status: shownPromise.status } : null,
        brokenPromises: brokenCount,
        openDisputes: cpDisputes.length,
        onHold,
        priority,
      });
    }

    const filtered = rows.filter((r) => {
      if (f.band && r.priority.band !== f.band) return false;
      if (f.minDays && (r.maxDaysOverdue ?? 0) < Number(f.minDays)) return false;
      const minAmount = f.minAmount ? tryParseAmount(f.minAmount) : null;
      if (minAmount !== null && (r.overdue > 0n ? r.overdue : r.outstanding) < minAmount) return false;
      if (f.assignee === "unassigned" && r.assignedUserId) return false;
      if (f.assignee && f.assignee !== "unassigned" && r.assignedUserId !== f.assignee) return false;
      if (f.counterpartyId && r.counterpartyId !== f.counterpartyId) return false;
      if (f.promise === "due_today" && !(r.promise?.status === "upcoming" && r.promise.date <= today)) return false;
      if (f.promise === "broken" && r.brokenPromises === 0) return false;
      if (f.promise === "none" && r.promise) return false;
      if (f.dispute === "open" && r.openDisputes === 0) return false;
      if (f.dispute === "none" && r.openDisputes > 0) return false;
      if (f.contact === "never" && r.lastContact) return false;
      if ((f.contact === "7" || f.contact === "14") && r.lastContact && diffDays(todayIn(business.timezone, r.lastContact), today) <= Number(f.contact)) return false;
      if (f.q && !r.name.toLowerCase().includes(f.q.toLowerCase())) return false;
      return true;
    });
    return filtered.sort((a, b) => b.priority.score - a.priority.score || (b.overdue > a.overdue ? 1 : b.overdue < a.overdue ? -1 : 0));
  });
}

export async function followUpTasks(ctx: TenantContext, f: { scope?: string; assignee?: string; status?: string }) {
  assertCan(ctx, "collections.work");
  return withTenant(ctx.businessId, async (tx) => {
    const t = toDbDate(ctx.today);
    const status = f.status === "completed" ? "completed" : f.status === "cancelled" ? "cancelled" : "pending";
    const where = {
      status: status as "pending" | "completed" | "cancelled",
      ...(f.assignee === "me" ? { assignedUserId: ctx.userId } : f.assignee ? { assignedUserId: f.assignee } : {}),
      ...(status === "pending" && f.scope === "today" ? { dueDate: { lte: t } } : {}),
      ...(status === "pending" && f.scope === "upcoming" ? { dueDate: { gt: t } } : {}),
    };
    const rows = await tx.followUp.findMany({
      where,
      orderBy: status === "pending" ? [{ dueDate: "asc" }, { priority: "desc" }] : [{ completedAt: "desc" }],
      take: 300,
      include: { counterparty: { select: { id: true, name: true, phone: true, isCustomer: true } }, invoice: { select: { id: true, invoiceNumber: true, direction: true } } },
    });
    const users = await tx.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.assignedUserId).filter(Boolean))] as string[] } }, select: { id: true, name: true } });
    return rows.map((r) => ({ ...r, dueDateIso: fromDbDate(r.dueDate), assigneeName: users.find((u) => u.id === r.assignedUserId)?.name ?? null }));
  });
}

export async function promiseList(ctx: TenantContext, status?: string) {
  assertCan(ctx, "receivables.view");
  return withTenant(ctx.businessId, async (tx) => {
    const rows = await tx.paymentPromise.findMany({
      where: status && status !== "all" ? (status === "review" ? { needsReview: true } : { status: status as never }) : {},
      orderBy: { promisedDate: "desc" },
      take: 300,
      include: { counterparty: { select: { id: true, name: true } }, invoices: { include: { invoice: { select: { id: true, invoiceNumber: true } } } } },
    });
    return rows.map((p) => ({ ...p, promisedIso: fromDbDate(p.promisedDate), amountP: paise(p.amount), receivedP: paise(p.amountReceived) }));
  });
}

export async function disputeList(ctx: TenantContext, status?: string) {
  return withTenant(ctx.businessId, async (tx) => {
    const canR = ctx.permissions.has("receivables.view");
    const canP = ctx.permissions.has("payables.view");
    const rows = await tx.dispute.findMany({
      where: {
        ...(status === "closed" ? { status: { in: ["resolved", "closed"] } } : status === "all" ? {} : { status: { notIn: ["resolved", "closed"] } }),
        invoice: { direction: { in: [...(canR ? ["receivable" as const] : []), ...(canP ? ["payable" as const] : [])] } },
      },
      orderBy: { raisedOn: "desc" },
      take: 300,
      include: { counterparty: { select: { id: true, name: true } }, invoice: { select: { id: true, invoiceNumber: true, direction: true, outstandingAmount: true, dueDate: true } } },
    });
    return rows;
  });
}
