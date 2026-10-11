import "server-only";
import type { InvoiceDirection } from "@prisma/client";
import { withTenant, type Tx } from "../db";
import { assertCan, type TenantContext } from "../authz";
import { loadSettings, paise } from "../services/common";
import { addDays, diffDays, endOfMonth, formatDate, fromDbDate, isISODate, startOfMonth, todayIn, toDbDate, zonedStartOfDay, type ISODate } from "@/domain/dates";
import { addToAgeing, emptyAgeing, type AgeingTotals } from "@/domain/ageing";
import type { Paise } from "@/domain/money";

// ---------------------------------------------------------------- periods

export interface Period {
  key: string;
  from: ISODate;
  to: ISODate;
  label: string;
}

export const PERIOD_OPTIONS = [
  { key: "today", label: "Today" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "month", label: "Current month" },
  { key: "prev_month", label: "Previous month" },
  { key: "custom", label: "Custom range" },
];

export function resolvePeriod(today: ISODate, key?: string, from?: string, to?: string): Period {
  switch (key) {
    case "today":
      return { key, from: today, to: today, label: `Today (${formatDate(today)})` };
    case "7d":
      return { key, from: addDays(today, -6), to: today, label: `Last 7 days (${formatDate(addDays(today, -6))} – ${formatDate(today)})` };
    case "month":
      return { key, from: startOfMonth(today), to: today, label: `Current month (${formatDate(startOfMonth(today))} – ${formatDate(today)})` };
    case "prev_month": {
      const end = addDays(startOfMonth(today), -1);
      return { key, from: startOfMonth(end), to: endOfMonth(end), label: `Previous month (${formatDate(startOfMonth(end))} – ${formatDate(end)})` };
    }
    case "custom":
      if (isISODate(from) && isISODate(to) && from <= to) return { key, from, to, label: `${formatDate(from)} – ${formatDate(to)}` };
      break;
  }
  return { key: "30d", from: addDays(today, -29), to: today, label: `Last 30 days (${formatDate(addDays(today, -29))} – ${formatDate(today)})` };
}

// ---------------------------------------------------------------- dashboard

/**
 * Metric definitions (all amounts in INR; "open" = lifecycle open, not void/draft):
 * - Outstanding: sum of outstanding balances of open invoices/bills.
 * - Overdue: outstanding where due date < today (business timezone). Due today is not overdue.
 * - Due today: outstanding where due date = today.
 * - Due in next 7 days: outstanding where today < due date ≤ today + 7.
 * - Collected / paid in period: sum of active (not reversed) payments dated within the period,
 *   whether or not allocated. Promises and planned payments are never counted.
 */
export async function dashboardMetrics(ctx: TenantContext, period: Period) {
  return withTenant(ctx.businessId, async (tx) => {
    const t = toDbDate(ctx.today);
    const t7 = toDbDate(addDays(ctx.today, 7));
    const sumOf = async (direction: InvoiceDirection, due?: object) =>
      paise((await tx.invoice.aggregate({ where: { direction, lifecycle: "open", outstandingAmount: { gt: 0 }, ...(due ? { dueDate: due } : {}) }, _sum: { outstandingAmount: true } }))._sum.outstandingAmount);
    const countOf = (direction: InvoiceDirection, due?: object) =>
      tx.invoice.count({ where: { direction, lifecycle: "open", outstandingAmount: { gt: 0 }, ...(due ? { dueDate: due } : {}) } });
    const paid = async (direction: "received" | "made") =>
      paise((await tx.payment.aggregate({ where: { direction, status: "active", paymentDate: { gte: toDbDate(period.from), lte: toDbDate(period.to) } }, _sum: { amount: true } }))._sum.amount);
    const block = async (direction: InvoiceDirection) => ({
      outstanding: await sumOf(direction),
      outstandingCount: await countOf(direction),
      overdue: await sumOf(direction, { lt: t }),
      overdueCount: await countOf(direction, { lt: t }),
      dueToday: await sumOf(direction, t),
      dueTodayCount: await countOf(direction, t),
      due7: await sumOf(direction, { gt: t, lte: t7 }),
      due7Count: await countOf(direction, { gt: t, lte: t7 }),
    });
    return {
      receivables: ctx.permissions.has("receivables.view") ? await block("receivable") : null,
      payables: ctx.permissions.has("payables.view") ? await block("payable") : null,
      collected: ctx.permissions.has("receivables.view") ? await paid("received") : null,
      paidOut: ctx.permissions.has("payables.view") ? await paid("made") : null,
    };
  });
}

export async function upcomingObligations(ctx: TenantContext, days = 14) {
  return withTenant(ctx.businessId, async (tx) => {
    const directions: InvoiceDirection[] = [];
    if (ctx.permissions.has("receivables.view")) directions.push("receivable");
    if (ctx.permissions.has("payables.view")) directions.push("payable");
    const rows = await tx.invoice.findMany({
      where: { direction: { in: directions }, lifecycle: "open", outstandingAmount: { gt: 0 }, dueDate: { gte: toDbDate(ctx.today), lte: toDbDate(addDays(ctx.today, days)) } },
      orderBy: [{ dueDate: "asc" }, { outstandingAmount: "desc" }],
      take: 12,
      include: { counterparty: { select: { name: true } }, plannedPayments: { where: { status: "scheduled" }, take: 1, orderBy: { plannedDate: "asc" } } },
    });
    return rows.map((r) => ({ id: r.id, direction: r.direction, invoiceNumber: r.invoiceNumber, name: r.counterparty.name, dueDate: fromDbDate(r.dueDate), outstanding: paise(r.outstandingAmount), planned: r.plannedPayments[0] ? fromDbDate(r.plannedPayments[0].plannedDate) : null }));
  });
}

export async function recentActivity(ctx: TenantContext, limit = 15) {
  return withTenant(ctx.businessId, async (tx) => {
    const rows = await tx.auditLog.findMany({
      where: {
        action: { in: ["invoice.created", "bill.created", "payment.received", "payment.made", "payment.reversed", "promise.created", "promise.evaluated", "followup.completed", "dispute.opened", "dispute.status_changed", "invoice.due_date_changed", "invoice.voided", "communication.logged", "import.completed", "allocation.reversed", "planned_payment.scheduled"] },
        ...(ctx.permissions.has("payables.view") ? {} : { NOT: { action: { in: ["bill.created", "payment.made", "planned_payment.scheduled"] } } }),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    const users = await tx.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.actorUserId).filter(Boolean))] as string[] } }, select: { id: true, name: true } });
    return rows.map((r) => ({ ...r, actor: r.actorUserId ? users.find((u) => u.id === r.actorUserId)?.name ?? "Former member" : "System" }));
  });
}

// ---------------------------------------------------------------- ageing

/**
 * Ageing as of a date: an invoice is included if issued on/before the as-of
 * date and not void; its balance as of that date = total − allocations from
 * payments dated on/before it − adjustments dated on/before it.
 */
async function balancesAsOf(tx: Tx, direction: InvoiceDirection, asOf: ISODate, counterpartyId?: string) {
  const invoices = await tx.invoice.findMany({
    where: { direction, lifecycle: "open", invoiceDate: { lte: toDbDate(asOf) }, ...(counterpartyId ? { counterpartyId } : {}) },
    include: {
      counterparty: { select: { id: true, name: true } },
      allocations: { where: { status: "active", payment: { paymentDate: { lte: toDbDate(asOf) } } }, select: { amount: true } },
      adjustments: { where: { status: "active", adjustmentDate: { lte: toDbDate(asOf) } }, select: { amount: true } },
    },
  });
  return invoices
    .map((i) => {
      const settled = i.allocations.reduce((a, x) => a + paise(x.amount), 0n) + i.adjustments.reduce((a, x) => a + paise(x.amount), 0n);
      return { id: i.id, invoiceNumber: i.invoiceNumber, counterparty: i.counterparty, invoiceDate: fromDbDate(i.invoiceDate), dueDate: fromDbDate(i.dueDate), total: paise(i.totalAmount), balance: paise(i.totalAmount) - settled };
    })
    .filter((i) => i.balance > 0n);
}

export async function ageingReport(ctx: TenantContext, direction: InvoiceDirection, asOf: ISODate) {
  assertCan(ctx, "reports.view");
  assertCan(ctx, direction === "receivable" ? "receivables.view" : "payables.view");
  return withTenant(ctx.businessId, async (tx) => {
    const rows = await balancesAsOf(tx, direction, asOf);
    const totals = emptyAgeing();
    const byCp = new Map<string, { id: string; name: string; ageing: AgeingTotals; invoices: typeof rows }>();
    for (const r of rows) {
      addToAgeing(totals, r.dueDate, asOf, r.balance);
      const g = byCp.get(r.counterparty.id) ?? { id: r.counterparty.id, name: r.counterparty.name, ageing: emptyAgeing(), invoices: [] };
      addToAgeing(g.ageing, r.dueDate, asOf, r.balance);
      g.invoices.push(r);
      byCp.set(r.counterparty.id, g);
    }
    const groups = [...byCp.values()].sort((a, b) => (b.ageing.overdue > a.ageing.overdue ? 1 : b.ageing.overdue < a.ageing.overdue ? -1 : b.ageing.total > a.ageing.total ? 1 : -1));
    for (const g of groups) g.invoices.sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
    return { asOf, totals, groups };
  });
}

// ---------------------------------------------------------------- customer / supplier balances

export async function counterpartyBalances(ctx: TenantContext, direction: InvoiceDirection) {
  return withTenant(ctx.businessId, async (tx) => {
    const { settings } = await loadSettings(tx, ctx.businessId);
    const t = toDbDate(ctx.today);
    const cps = await tx.counterparty.findMany({
      where: direction === "receivable" ? { isCustomer: true } : { isSupplier: true },
      orderBy: { name: "asc" },
      include: {
        invoices: { where: { direction, lifecycle: "open", outstandingAmount: { gt: 0 } }, select: { id: true, invoiceNumber: true, dueDate: true, outstandingAmount: true, plannedPayments: { where: { status: "scheduled" }, select: { plannedDate: true, amount: true } } } },
        disputes: { where: { status: { notIn: ["resolved", "closed"] }, invoice: { direction } }, select: { id: true, disputedAmount: true, invoice: { select: { outstandingAmount: true } } } },
        promises: direction === "receivable" ? { where: { status: "broken", promisedDate: { gte: toDbDate(addDays(ctx.today, -settings.brokenPromiseWindowDays)) } }, select: { id: true } } : false,
        payments: { where: { status: "active", direction: direction === "receivable" ? "received" : "made" }, orderBy: { paymentDate: "desc" }, take: 1, select: { paymentDate: true, amount: true } },
      },
    });
    const delays = direction === "receivable" ? await paymentDelays(tx) : new Map<string, { avg: number; n: number }>();
    return cps.map((c) => {
      let open = 0n, overdue = 0n, current = 0n, due7 = 0n, planned = 0n;
      let oldest: { invoiceNumber: string; dueDate: string } | null = null;
      for (const i of c.invoices) {
        const amt = paise(i.outstandingAmount);
        open += amt;
        if (i.dueDate < t) overdue += amt;
        else current += amt;
        if (i.dueDate >= t && fromDbDate(i.dueDate) <= addDays(ctx.today, 7)) due7 += amt;
        for (const p of i.plannedPayments) planned += paise(p.amount);
        if (!oldest || fromDbDate(i.dueDate) < oldest.dueDate) oldest = { invoiceNumber: i.invoiceNumber, dueDate: fromDbDate(i.dueDate) };
      }
      const disputedAmount = c.disputes.reduce((a, d) => a + (d.disputedAmount !== null ? paise(d.disputedAmount) : paise(d.invoice.outstandingAmount)), 0n);
      const nextPlanned = c.invoices.flatMap((i) => i.plannedPayments.map((p) => fromDbDate(p.plannedDate))).sort()[0] ?? null;
      return {
        id: c.id,
        name: c.name,
        accountCode: c.accountCode,
        status: c.status,
        creditLimit: c.creditLimit !== null ? paise(c.creditLimit) : null,
        open, overdue, current, due7, planned, nextPlanned,
        openInvoices: c.invoices.length,
        oldest,
        disputes: c.disputes.length,
        disputedAmount,
        brokenPromises: Array.isArray(c.promises) ? c.promises.length : 0,
        lastPayment: c.payments[0] ? { date: fromDbDate(c.payments[0].paymentDate), amount: paise(c.payments[0].amount) } : null,
        avgDelay: delays.get(c.id) ?? null,
      };
    });
  });
}

/**
 * Average payment delay per customer: for receivables fully settled by
 * payments, days from due date to settlement date (negative = early). Only
 * reported when at least 3 settled invoices exist; otherwise "insufficient data".
 */
export const MIN_DELAY_SAMPLE = 3;
async function paymentDelays(tx: Tx, counterpartyId?: string) {
  const settled = await tx.invoice.findMany({
    where: { direction: "receivable", lifecycle: "open", outstandingAmount: 0, settledOn: { not: null }, amountPaid: { gt: 0 }, ...(counterpartyId ? { counterpartyId } : {}) },
    select: { counterpartyId: true, dueDate: true, settledOn: true },
  });
  const acc = new Map<string, number[]>();
  for (const s of settled) {
    const arr = acc.get(s.counterpartyId) ?? [];
    arr.push(diffDays(fromDbDate(s.dueDate), fromDbDate(s.settledOn!)));
    acc.set(s.counterpartyId, arr);
  }
  const out = new Map<string, { avg: number; n: number }>();
  for (const [k, v] of acc) if (v.length >= MIN_DELAY_SAMPLE) out.set(k, { avg: Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10, n: v.length });
  return out;
}

/** Descriptive payment-behaviour facts for one customer. Never a fraud or solvency judgement. */
export async function customerBehaviour(ctx: TenantContext, counterpartyId: string) {
  return withTenant(ctx.businessId, async (tx) => {
    const { settings } = await loadSettings(tx, ctx.businessId);
    const all = await tx.invoice.findMany({
      where: { counterpartyId, direction: "receivable", lifecycle: "open" },
      select: { dueDate: true, settledOn: true, outstandingAmount: true, totalAmount: true, invoiceDate: true },
      orderBy: { invoiceDate: "asc" },
    });
    const settledRows = all.filter((i) => i.settledOn);
    const delays = settledRows.map((i) => diffDays(fromDbDate(i.dueDate), fromDbDate(i.settledOn!)));
    const avg = delays.length >= MIN_DELAY_SAMPLE ? delays.reduce((a, b) => a + b, 0) / delays.length : null;
    const lateShare = settledRows.length >= MIN_DELAY_SAMPLE ? delays.filter((d) => d > 0).length / delays.length : null;
    // Recent change: last 3 settled vs earlier ones.
    let trend: number | null = null;
    if (delays.length >= 6) {
      const recent = delays.slice(-3);
      const earlier = delays.slice(0, -3);
      trend = recent.reduce((a, b) => a + b, 0) / 3 - earlier.reduce((a, b) => a + b, 0) / earlier.length;
    }
    const broken = await tx.paymentPromise.count({ where: { counterpartyId, status: "broken" } });
    const brokenWindow = await tx.paymentPromise.count({ where: { counterpartyId, status: "broken", promisedDate: { gte: toDbDate(addDays(ctx.today, -settings.brokenPromiseWindowDays)) } } });
    const kept = await tx.paymentPromise.count({ where: { counterpartyId, status: { in: ["kept"] } } });
    const openDisputes = await tx.dispute.count({ where: { counterpartyId, status: { notIn: ["resolved", "closed"] } } });
    const cp = await tx.counterparty.findUniqueOrThrow({ where: { id: counterpartyId }, select: { creditLimit: true } });
    const outstanding = all.reduce((a, i) => a + paise(i.outstandingAmount), 0n);
    const avgInvoice = all.length ? all.reduce((a, i) => a + paise(i.totalAmount), 0n) / BigInt(all.length) : null;

    // Credit-review suggestions: factual prompts for a human; never automatic decisions.
    const suggestions: { text: string; basis: string }[] = [];
    if (brokenWindow >= settings.brokenPromiseThreshold) suggestions.push({ text: "Review the credit limit and payment terms", basis: `${brokenWindow} broken promises in the last ${settings.brokenPromiseWindowDays} days` });
    if (avg !== null && avg > 15) suggestions.push({ text: "Consider shorter payment terms or advance payment for the next order", basis: `Settles on average ${avg.toFixed(1)} days after the due date (${delays.length} invoices)` });
    if (openDisputes > 0) suggestions.push({ text: "Resolve open disputes before increasing exposure", basis: `${openDisputes} open dispute${openDisputes === 1 ? "" : "s"}` });
    if (cp.creditLimit !== null && outstanding > paise(cp.creditLimit)) suggestions.push({ text: "Outstanding balance exceeds the approved credit limit — review before new orders", basis: `Outstanding exceeds the limit` });
    if (trend !== null && trend > 10) suggestions.push({ text: "Payment timing has slipped recently — request remittance plan or documentation", basis: `Last 3 settlements average ${trend.toFixed(0)} days later than earlier ones` });

    return {
      settledCount: settledRows.length,
      avgDelay: avg,
      lateShare,
      trend,
      brokenTotal: broken,
      brokenWindow,
      kept,
      openDisputes,
      avgInvoice,
      outstanding,
      creditLimit: cp.creditLimit !== null ? paise(cp.creditLimit) : null,
      sufficient: settledRows.length >= MIN_DELAY_SAMPLE,
      suggestions,
    };
  });
}

// ---------------------------------------------------------------- collections effectiveness

/**
 * Definitions for period [from, to] (business-local dates):
 * - Overdue accounts: customers with ≥1 receivable invoice that was overdue on some day in the period
 *   (due date + 1 ≤ to, and not settled before max(due date + 1, from)).
 * - Accounts contacted: of those, customers with ≥1 logged communication in the period on or after
 *   the day their invoice became overdue.
 * - First-contact delay: for invoices that became overdue during the period, days from becoming
 *   overdue to the first communication with that customer; uncontacted invoices are counted separately.
 * - Opening overdue balance: balances overdue at the end of (from − 1), as of that date.
 *   Collected against it: allocations to those invoices from payments dated in the period.
 * - Promises: recorded in the period (by recorded date); outcomes for promises whose promised date is in the period.
 * - Follow-ups completed on time: of follow-ups due in the period, completed on or before their due date.
 * - Overdue amount recovered: allocations dated in the period to invoices whose due date was before the payment date.
 */
export async function collectionsEffectiveness(ctx: TenantContext, period: Period) {
  assertCan(ctx, "receivables.view");
  return withTenant(ctx.businessId, async (tx) => {
    const { business } = await loadSettings(tx, ctx.businessId);
    const from = period.from;
    const to = period.to;
    const invoices = await tx.invoice.findMany({
      where: { direction: "receivable", lifecycle: "open", dueDate: { lt: toDbDate(to) } },
      select: { id: true, counterpartyId: true, dueDate: true, settledOn: true },
    });
    const overdueInPeriod = invoices.filter((i) => {
      const becameOverdue = addDays(fromDbDate(i.dueDate), 1);
      if (becameOverdue > to) return false;
      const windowStart = becameOverdue > from ? becameOverdue : from;
      return !i.settledOn || fromDbDate(i.settledOn) >= windowStart;
    });
    const comms = await tx.communication.findMany({
      where: { contactedAt: { lte: zonedStartOfDay(addDays(to, 1), business.timezone) } },
      select: { counterpartyId: true, contactedAt: true },
      orderBy: { contactedAt: "asc" },
    });
    const commDates = new Map<string, string[]>();
    for (const c of comms) {
      const d = todayIn(business.timezone, c.contactedAt);
      const arr = commDates.get(c.counterpartyId) ?? [];
      arr.push(d);
      commDates.set(c.counterpartyId, arr);
    }
    const accounts = new Map<string, string>(); // cp -> earliest overdue start within period
    for (const i of overdueInPeriod) {
      const start = addDays(fromDbDate(i.dueDate), 1);
      const s = start > from ? start : from;
      const cur = accounts.get(i.counterpartyId);
      if (!cur || s < cur) accounts.set(i.counterpartyId, s);
    }
    let contacted = 0;
    for (const [cp, start] of accounts) if ((commDates.get(cp) ?? []).some((d) => d >= start && d <= to)) contacted++;

    const firstContactDelays: number[] = [];
    let notYetContacted = 0;
    for (const i of overdueInPeriod) {
      const start = addDays(fromDbDate(i.dueDate), 1);
      if (start < from) continue;
      const first = (commDates.get(i.counterpartyId) ?? []).find((d) => d >= start);
      if (first) firstContactDelays.push(diffDays(start, first));
      else notYetContacted++;
    }

    const openingDate = addDays(from, -1);
    const opening = (await balancesAsOf(tx, "receivable", openingDate)).filter((r) => r.dueDate < openingDate);
    const openingOverdue = opening.reduce((a, r) => a + r.balance, 0n);
    const collectedAgainstOpening = opening.length
      ? paise((await tx.paymentAllocation.aggregate({ where: { status: "active", invoiceId: { in: opening.map((r) => r.id) }, payment: { paymentDate: { gte: toDbDate(from), lte: toDbDate(to) } } }, _sum: { amount: true } }))._sum.amount)
      : 0n;

    const allocs = await tx.paymentAllocation.findMany({
      where: { status: "active", invoice: { direction: "receivable" }, payment: { status: "active", paymentDate: { gte: toDbDate(from), lte: toDbDate(to) } } },
      select: { amount: true, invoice: { select: { dueDate: true } }, payment: { select: { paymentDate: true } } },
    });
    const recoveredOverdue = allocs.filter((a) => a.payment.paymentDate > a.invoice.dueDate).reduce((s, a) => s + paise(a.amount), 0n);

    const fromTs = zonedStartOfDay(from, business.timezone);
    const toTs = zonedStartOfDay(addDays(to, 1), business.timezone);
    const promisesRecorded = await tx.paymentPromise.count({ where: { recordedAt: { gte: fromTs, lt: toTs } } });
    const outcomes = await tx.paymentPromise.groupBy({ by: ["status"], where: { promisedDate: { gte: toDbDate(from), lte: toDbDate(to) } }, _count: true });
    const oc = (s: string) => outcomes.find((o) => o.status === s)?._count ?? 0;

    const fus = await tx.followUp.findMany({ where: { dueDate: { gte: toDbDate(from), lte: toDbDate(to) }, status: { not: "cancelled" } }, select: { dueDate: true, status: true, completedAt: true } });
    const onTime = fus.filter((f) => f.status === "completed" && f.completedAt && todayIn(business.timezone, f.completedAt) <= fromDbDate(f.dueDate)).length;

    const avg = firstContactDelays.length ? firstContactDelays.reduce((a, b) => a + b, 0) / firstContactDelays.length : null;
    const sorted = [...firstContactDelays].sort((a, b) => a - b);
    const median = sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null;
    return {
      period,
      overdueAccounts: accounts.size,
      contactedAccounts: contacted,
      firstContact: { avg, median, n: firstContactDelays.length, notYetContacted },
      openingOverdue,
      collectedAgainstOpening,
      recoveredOverdue,
      promises: { recorded: promisesRecorded, kept: oc("kept"), partiallyKept: oc("partially_kept"), broken: oc("broken"), upcoming: oc("upcoming"), cancelled: oc("cancelled") },
      followUps: { due: fus.length, completedOnTime: onTime, completedLate: fus.filter((f) => f.status === "completed").length - onTime, stillPending: fus.filter((f) => f.status === "pending").length },
    };
  });
}

// ---------------------------------------------------------------- productivity

export async function followUpProductivity(ctx: TenantContext, period: Period) {
  assertCan(ctx, "reports.view");
  return withTenant(ctx.businessId, async (tx) => {
    const { business } = await loadSettings(tx, ctx.businessId);
    const fus = await tx.followUp.findMany({
      where: { dueDate: { gte: toDbDate(period.from), lte: toDbDate(period.to) } },
      select: { assignedUserId: true, status: true, dueDate: true, completedAt: true, type: true, source: true },
    });
    const comms = await tx.communication.groupBy({
      by: ["createdById"],
      where: { contactedAt: { gte: zonedStartOfDay(period.from, business.timezone), lt: zonedStartOfDay(addDays(period.to, 1), business.timezone) } },
      _count: true,
    });
    const members = await tx.membership.findMany({ where: { businessId: ctx.businessId }, include: { user: { select: { id: true, name: true } } } });
    const rows = members.map((m) => {
      const mine = fus.filter((f) => f.assignedUserId === m.userId);
      const completed = mine.filter((f) => f.status === "completed");
      const onTime = completed.filter((f) => f.completedAt && todayIn(business.timezone, f.completedAt) <= fromDbDate(f.dueDate)).length;
      return {
        userId: m.userId,
        name: m.user.name,
        role: m.role,
        due: mine.filter((f) => f.status !== "cancelled").length,
        completedOnTime: onTime,
        completedLate: completed.length - onTime,
        missed: mine.filter((f) => f.status === "pending" && fromDbDate(f.dueDate) < ctx.today).length,
        pending: mine.filter((f) => f.status === "pending" && fromDbDate(f.dueDate) >= ctx.today).length,
        escalated: mine.filter((f) => f.type === "escalation").length,
        communications: comms.find((c) => c.createdById === m.userId)?._count ?? 0,
      };
    });
    const unassigned = fus.filter((f) => !f.assignedUserId);
    return { rows, unassignedDue: unassigned.filter((f) => f.status !== "cancelled").length };
  });
}

// ---------------------------------------------------------------- cash-flow outlook

/**
 * Operational forecast, not a prediction:
 * - Expected collections: receivable balances falling due in (today, today + h], plus those due today.
 * - Scheduled supplier payments: planned payments dated in [today, today + h].
 * - Other payables due: bill balances due in [today, today + h] not covered by a planned payment.
 * - Overdue incoming / outgoing: balances already past due (timing uncertain, shown separately).
 * - Net expected movement = expected collections − (scheduled payments + other payables due).
 * Promises appear as a memo line only; nothing speculative is added to actual cash.
 */
export async function cashFlowOutlook(ctx: TenantContext) {
  assertCan(ctx, "reports.view");
  return withTenant(ctx.businessId, async (tx) => {
    const t = toDbDate(ctx.today);
    const [recv, pay, planned, promises, hist] = await Promise.all([
      tx.invoice.findMany({ where: { direction: "receivable", lifecycle: "open", outstandingAmount: { gt: 0 } }, select: { dueDate: true, outstandingAmount: true } }),
      tx.invoice.findMany({ where: { direction: "payable", lifecycle: "open", outstandingAmount: { gt: 0 } }, select: { id: true, dueDate: true, outstandingAmount: true } }),
      tx.plannedPayment.findMany({ where: { status: "scheduled" }, select: { invoiceId: true, plannedDate: true, amount: true } }),
      tx.paymentPromise.findMany({ where: { status: "upcoming" }, select: { promisedDate: true, amount: true } }),
      tx.payment.groupBy({ by: ["direction"], where: { status: "active", paymentDate: { gte: toDbDate(addDays(ctx.today, -29)), lte: t } }, _sum: { amount: true } }),
    ]);
    const horizons = [7, 14, 30].map((h) => {
      const end = addDays(ctx.today, h);
      const inH = (d: Date) => fromDbDate(d) >= ctx.today && fromDbDate(d) <= end;
      const expectedIn = recv.filter((r) => inH(r.dueDate)).reduce((a, r) => a + paise(r.outstandingAmount), 0n);
      const plannedOut = planned.filter((p) => inH(p.plannedDate)).reduce((a, p) => a + paise(p.amount), 0n);
      const plannedByInvoice = new Map<string, Paise>();
      for (const p of planned) plannedByInvoice.set(p.invoiceId, (plannedByInvoice.get(p.invoiceId) ?? 0n) + paise(p.amount));
      const otherPayables = pay
        .filter((b) => inH(b.dueDate))
        .reduce((a, b) => {
          const rem = paise(b.outstandingAmount) - (plannedByInvoice.get(b.id) ?? 0n);
          return a + (rem > 0n ? rem : 0n);
        }, 0n);
      const promised = promises.filter((p) => inH(p.promisedDate)).reduce((a, p) => a + paise(p.amount), 0n);
      return { days: h, end, expectedIn, plannedOut, otherPayables, net: expectedIn - plannedOut - otherPayables, promised };
    });
    const overdueIn = recv.filter((r) => r.dueDate < t).reduce((a, r) => a + paise(r.outstandingAmount), 0n);
    const overdueOut = pay.filter((r) => r.dueDate < t).reduce((a, r) => a + paise(r.outstandingAmount), 0n);
    return {
      horizons,
      overdueIn,
      overdueOut,
      actual30: {
        received: paise(hist.find((h) => h.direction === "received")?._sum.amount),
        paid: paise(hist.find((h) => h.direction === "made")?._sum.amount),
      },
    };
  });
}

/** Statement of account: chronological invoices, payments and adjustments with running balance. */
export async function statement(ctx: TenantContext, counterpartyId: string, direction: InvoiceDirection, from?: string, to?: string) {
  assertCan(ctx, direction === "receivable" ? "receivables.view" : "payables.view");
  return withTenant(ctx.businessId, async (tx) => {
    const cp = await tx.counterparty.findUniqueOrThrow({ where: { id: counterpartyId } });
    const start = isISODate(from) ? from : "1900-01-01";
    const end = isISODate(to) ? to : ctx.today;
    const invoices = await tx.invoice.findMany({ where: { counterpartyId, direction, lifecycle: "open" }, select: { id: true, invoiceNumber: true, invoiceDate: true, dueDate: true, totalAmount: true, outstandingAmount: true } });
    const allocations = await tx.paymentAllocation.findMany({
      where: { status: "active", invoice: { counterpartyId, direction } },
      include: { payment: { select: { paymentDate: true, method: true, reference: true } }, invoice: { select: { invoiceNumber: true } } },
    });
    const adjustments = await tx.adjustment.findMany({ where: { status: "active", invoice: { counterpartyId, direction } }, include: { invoice: { select: { invoiceNumber: true } } } });
    type Line = { date: string; kind: string; ref: string; debit: Paise; credit: Paise };
    const lines: Line[] = [
      ...invoices.map((i) => ({ date: fromDbDate(i.invoiceDate), kind: direction === "receivable" ? "Invoice" : "Bill", ref: `${i.invoiceNumber} (due ${formatDate(i.dueDate)})`, debit: paise(i.totalAmount), credit: 0n })),
      ...allocations.map((a) => ({ date: fromDbDate(a.payment.paymentDate), kind: "Payment", ref: `${a.payment.method}${a.payment.reference ? ` ${a.payment.reference}` : ""} → ${a.invoice.invoiceNumber}`, debit: 0n, credit: paise(a.amount) })),
      ...adjustments.map((a) => ({ date: fromDbDate(a.adjustmentDate), kind: a.kind === "credit_note" ? "Credit note" : "Write-off", ref: `${a.reference ?? ""} → ${a.invoice.invoiceNumber}`, debit: 0n, credit: paise(a.amount) })),
    ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.debit > 0n ? -1 : 1));
    let opening = 0n;
    const rows: (Line & { balance: Paise })[] = [];
    let bal = 0n;
    for (const l of lines) {
      bal += l.debit - l.credit;
      if (l.date < start) opening = bal;
      else if (l.date <= end) rows.push({ ...l, balance: bal });
    }
    const unallocated = await tx.payment.findMany({ where: { counterpartyId, direction: direction === "receivable" ? "received" : "made", status: "active" }, select: { amount: true, allocatedAmount: true } });
    const unallocatedTotal = unallocated.reduce((a, p) => a + paise(p.amount) - paise(p.allocatedAmount), 0n);
    const outstanding = invoices.reduce((a, i) => a + paise(i.outstandingAmount), 0n);
    const overdue = invoices.filter((i) => fromDbDate(i.dueDate) < ctx.today).reduce((a, i) => a + paise(i.outstandingAmount), 0n);
    return { cp, from: start === "1900-01-01" ? null : start, to: end, opening, rows, closing: rows.length ? rows[rows.length - 1].balance : opening, outstanding, overdue, unallocatedTotal };
  });
}
