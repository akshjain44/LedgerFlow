import { Fragment } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { requireTenant, type TenantContext } from "@/server/context";
import { ageingReport, counterpartyBalances, collectionsEffectiveness, followUpProductivity, cashFlowOutlook, resolvePeriod } from "@/server/queries/reports";
import { Badge, Card, EmptyState, LinkButton, Notice, PageHeader, Stat, Table, Td, Th } from "@/components/ui";
import { DateText, Money } from "@/components/format";
import { PeriodFilter } from "@/components/PeriodFilter";
import { PrintButton } from "@/components/PrintButton";
import { CashFlowChart } from "@/components/charts";
import { AGEING_BUCKETS } from "@/domain/ageing";
import { formatDate, isISODate } from "@/domain/dates";
import { formatINR } from "@/domain/money";
import { chartRupees, pct } from "@/lib/display";
import { ROLE_LABELS } from "@/domain/permissions";

const TITLES: Record<string, string> = {
  "receivables-ageing": "Receivables ageing",
  "payables-ageing": "Payables ageing",
  "customer-outstanding": "Customer outstanding",
  "supplier-obligations": "Supplier obligations",
  collections: "Collections effectiveness",
  productivity: "Follow-up productivity",
  "cash-flow": "Cash-flow outlook",
};

export async function generateMetadata({ params }: { params: Promise<{ report: string }> }) {
  return { title: TITLES[(await params).report] ?? "Report" };
}

export default async function ReportPage({ params, searchParams }: { params: Promise<{ report: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireTenant("reports.view");
  const { report } = await params;
  const sp = await searchParams;
  if (!TITLES[report]) notFound();
  const recvReports = ["receivables-ageing", "customer-outstanding", "collections"];
  if (recvReports.includes(report) && !ctx.permissions.has("receivables.view")) notFound();
  if (["payables-ageing", "supplier-obligations", "cash-flow"].includes(report) && !ctx.permissions.has("payables.view")) notFound();
  const exportable = ctx.permissions.has("exports.run") && !["collections", "cash-flow"].includes(report);
  const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]).toString();
  return (
    <>
      <PageHeader
        breadcrumbs={[{ href: "/reports", label: "Reports" }, { label: TITLES[report] }]}
        title={TITLES[report]}
        actions={<>{exportable && <LinkButton href={`/api/export/report-${report}${qs ? `?${qs}` : ""}`} prefetch={false}><Download className="h-4 w-4" />Export CSV</LinkButton>}<PrintButton label="Print" /></>}
      />
      {report.endsWith("ageing") && <Ageing ctx={ctx} direction={report.startsWith("receivables") ? "receivable" : "payable"} asOf={isISODate(sp.asOf) ? sp.asOf : ctx.today} cp={sp.counterpartyId} />}
      {report === "customer-outstanding" && <Balances ctx={ctx} direction="receivable" />}
      {report === "supplier-obligations" && <Balances ctx={ctx} direction="payable" />}
      {report === "collections" && <Collections ctx={ctx} sp={sp} />}
      {report === "productivity" && <Productivity ctx={ctx} sp={sp} />}
      {report === "cash-flow" && <CashFlow ctx={ctx} />}
    </>
  );
}

async function Ageing({ ctx, direction, asOf, cp }: { ctx: TenantContext; direction: "receivable" | "payable"; asOf: string; cp?: string }) {
  const r = await ageingReport(ctx, direction, asOf);
  const groups = cp ? r.groups.filter((g) => g.id === cp) : r.groups;
  const base = direction === "receivable" ? "receivables" : "payables";
  return (
    <>
      <form className="no-print mb-4 flex flex-wrap items-end gap-2 text-[13px]">
        <label>As of<input type="date" name="asOf" defaultValue={asOf} max={ctx.today} className="ml-1 h-8 rounded-md border border-line-strong px-2" /></label>
        <label>{direction === "receivable" ? "Customer" : "Supplier"}
          <select name="counterpartyId" defaultValue={cp ?? ""} className="ml-1 h-8 rounded-md border border-line-strong bg-surface px-2">
            <option value="">All</option>
            {r.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </label>
        <button className="h-8 rounded-md border border-line-strong bg-surface px-3 font-medium">Apply</button>
      </form>
      <p className="mb-3 text-[13px] text-muted">Balances as of {formatDate(asOf)}: invoice total minus payments dated and adjustments made on or before that date. Buckets are days past the due date; due on the as-of date counts as “Due today”, not overdue. Void and draft invoices are excluded.</p>
      <div className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-7">
        {AGEING_BUCKETS.map((b) => <Stat key={b.key} label={b.label} tone={b.overdue && r.totals[b.key] > 0n ? "bad" : "neutral"} value={<Money value={r.totals[b.key]} compact />} />)}
        <Stat label="Total" value={<Money value={r.totals.total} compact />} sub={<>overdue <Money value={r.totals.overdue} compact /></>} />
      </div>
      <Card padded={false}>
        {groups.length === 0 ? <div className="p-4"><EmptyState title="Nothing outstanding as of this date" /></div> : (
          <Table>
            <thead><tr><Th>{direction === "receivable" ? "Customer / invoice" : "Supplier / bill"}</Th>{AGEING_BUCKETS.map((b) => <Th key={b.key} align="right">{b.label}</Th>)}<Th align="right">Total</Th></tr></thead>
            <tbody>
              {groups.map((g) => (
                <Fragment key={g.id}>
                  <tr className="bg-[#fafaf7] font-semibold">
                    <Td><Link href={`/${direction === "receivable" ? "customers" : "suppliers"}/${g.id}`} className="hover:underline">{g.name}</Link></Td>
                    {AGEING_BUCKETS.map((b) => <Td key={b.key} align="right">{g.ageing[b.key] > 0n ? <Money value={g.ageing[b.key]} /> : <span className="text-muted">—</span>}</Td>)}
                    <Td align="right"><Money value={g.ageing.total} /></Td>
                  </tr>
                  {g.invoices.map((i) => {
                    const days = Math.round((Date.parse(asOf) - Date.parse(i.dueDate)) / 86400000);
                    const key = days < 0 ? "not_due" : days === 0 ? "due_today" : days <= 30 ? "d1_30" : days <= 60 ? "d31_60" : days <= 90 ? "d61_90" : "d90_plus";
                    return (
                      <tr key={i.id} className="text-[13px]">
                        <Td className="pl-6"><Link href={`/${base}/${i.id}`} className="text-accent hover:underline">{i.invoiceNumber}</Link> <span className="text-muted">due <DateText value={i.dueDate} /></span></Td>
                        {AGEING_BUCKETS.map((b) => <Td key={b.key} align="right">{b.key === key ? <Money value={i.balance} /> : ""}</Td>)}
                        <Td align="right"><Money value={i.balance} /></Td>
                      </tr>
                    );
                  })}
                </Fragment>
              ))}
              <tr className="font-semibold">
                <Td>Total</Td>
                {AGEING_BUCKETS.map((b) => <Td key={b.key} align="right"><Money value={groups.reduce((a, g) => a + g.ageing[b.key], 0n)} /></Td>)}
                <Td align="right"><Money value={groups.reduce((a, g) => a + g.ageing.total, 0n)} /></Td>
              </tr>
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

async function Balances({ ctx, direction }: { ctx: TenantContext; direction: "receivable" | "payable" }) {
  const rows = (await counterpartyBalances(ctx, direction)).filter((r) => r.open > 0n || r.disputes > 0 || r.planned > 0n);
  const recv = direction === "receivable";
  const total = rows.reduce((a, r) => ({ open: a.open + r.open, overdue: a.overdue + r.overdue, current: a.current + r.current, due7: a.due7 + r.due7, planned: a.planned + r.planned, disputed: a.disputed + r.disputedAmount }), { open: 0n, overdue: 0n, current: 0n, due7: 0n, planned: 0n, disputed: 0n });
  return (
    <>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total outstanding" value={<Money value={total.open} />} />
        <Stat label="Overdue" tone="bad" value={<Money value={total.overdue} />} />
        <Stat label={recv ? "Current (not yet overdue)" : "Due in next 7 days"} value={<Money value={recv ? total.current : total.due7} />} />
        <Stat label={recv ? "Accounts with balances" : "Payments planned"} value={recv ? String(rows.length) : <Money value={total.planned} />} sub={!recv ? <>Disputed: <Money value={total.disputed} /></> : undefined} />
      </div>
      <Card padded={false}>
        {rows.length === 0 ? <div className="p-4"><EmptyState title="No open balances" /></div> : (
          <Table>
            <thead>
              {recv ? (
                <tr><Th>Customer</Th><Th align="right">Open</Th><Th align="right">Overdue</Th><Th align="right">Current</Th><Th>Oldest invoice</Th><Th>Payment timing</Th><Th>Last payment</Th><Th align="right">Broken promises</Th><Th align="right">Disputes</Th></tr>
              ) : (
                <tr><Th>Supplier</Th><Th align="right">Outstanding</Th><Th align="right">Overdue</Th><Th align="right">Due in 7 days</Th><Th align="right">Planned</Th><Th>Next planned</Th><Th align="right">Disputed</Th><Th>Last payment</Th></tr>
              )}
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td><Link href={`/${recv ? "customers" : "suppliers"}/${r.id}`} className="font-medium hover:underline">{r.name}</Link>{r.creditLimit !== null && r.open > r.creditLimit && <Badge tone="warn" className="ml-1">Over limit</Badge>}</Td>
                  <Td align="right"><Money value={r.open} /></Td>
                  <Td align="right"><Money value={r.overdue} tone="bad" /></Td>
                  {recv ? (
                    <>
                      <Td align="right"><Money value={r.current} /></Td>
                      <Td>{r.oldest ? <>{r.oldest.invoiceNumber}<span className="block text-[12px] text-muted">due <DateText value={r.oldest.dueDate} /></span></> : "—"}</Td>
                      <Td className="text-[12.5px]">{r.avgDelay ? `${r.avgDelay.avg > 0 ? `${r.avgDelay.avg}d late` : `${-r.avgDelay.avg}d early`} avg (n=${r.avgDelay.n})` : <span className="text-muted">Insufficient data</span>}</Td>
                      <Td>{r.lastPayment ? <><DateText value={r.lastPayment.date} /><span className="block text-[12px] text-muted"><Money value={r.lastPayment.amount} /></span></> : "—"}</Td>
                      <Td align="right">{r.brokenPromises || "—"}</Td>
                      <Td align="right">{r.disputes || "—"}</Td>
                    </>
                  ) : (
                    <>
                      <Td align="right"><Money value={r.due7} /></Td>
                      <Td align="right"><Money value={r.planned} /></Td>
                      <Td>{r.nextPlanned ? <DateText value={r.nextPlanned} /> : "—"}</Td>
                      <Td align="right">{r.disputedAmount > 0n ? <Money value={r.disputedAmount} /> : "—"}</Td>
                      <Td>{r.lastPayment ? <DateText value={r.lastPayment.date} /> : "—"}</Td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {recv && <p className="mt-2 text-[12.5px] text-muted">Payment timing = average days between due date and the date an invoice was fully settled, shown only with 3+ settled invoices. It describes past behaviour and is not a credit decision.</p>}
    </>
  );
}

async function Collections({ ctx, sp }: { ctx: TenantContext; sp: Record<string, string | undefined> }) {
  const period = resolvePeriod(ctx.today, sp.period, sp.from, sp.to);
  const e = await collectionsEffectiveness(ctx, period);
  return (
    <>
      <div className="mb-4"><PeriodFilter period={period} basePath="/reports/collections" /></div>
      <p className="mb-4 text-[13px] text-muted">Period: {period.label}</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Overdue accounts contacted" value={e.overdueAccounts ? `${e.contactedAccounts} / ${e.overdueAccounts}` : "—"} sub={e.overdueAccounts ? pct(e.contactedAccounts / e.overdueAccounts) : "No overdue accounts in period"} />
        <Stat label="Average days to first contact" value={e.firstContact.avg !== null ? e.firstContact.avg.toFixed(1) : "—"} sub={e.firstContact.n ? `median ${e.firstContact.median} · ${e.firstContact.n} invoices` : "No newly overdue invoices contacted"} />
        <Stat label="Newly overdue, not yet contacted" tone={e.firstContact.notYetContacted ? "bad" : "neutral"} value={String(e.firstContact.notYetContacted)} />
        <Stat label="Overdue amounts recovered" tone="ok" value={<Money value={e.recoveredOverdue} />} />
        <Stat label="Opening overdue balance" value={<Money value={e.openingOverdue} />} sub={`as of ${formatDate(period.from)} (start)`} />
        <Stat label="Collected against opening overdue" value={<Money value={e.collectedAgainstOpening} />} sub={e.openingOverdue > 0n ? pct(Number(e.collectedAgainstOpening) / Number(e.openingOverdue)) : "No opening overdue"} />
        <Stat label="Promises recorded" value={String(e.promises.recorded)} sub={`${e.promises.kept} kept · ${e.promises.partiallyKept} partial · ${e.promises.broken} broken (due in period)`} />
        <Stat label="Follow-ups completed on time" value={e.followUps.due ? `${e.followUps.completedOnTime} / ${e.followUps.due}` : "—"} sub={e.followUps.due ? `${pct(e.followUps.completedOnTime / e.followUps.due)} · ${e.followUps.completedLate} late · ${e.followUps.stillPending} pending` : "None due in period"} />
      </div>
      <Card className="mt-5" title="Definitions">
        <ul className="list-disc space-y-1.5 pl-5 text-[13.5px] text-ink-2">
          <li><strong>Overdue accounts</strong>: customers with at least one invoice that was overdue on some day in the period (positive balance, past its due date).</li>
          <li><strong>Contacted</strong>: a call, message, visit or note was logged for that customer in the period, on or after the day the invoice became overdue.</li>
          <li><strong>Days to first contact</strong>: for invoices that became overdue during the period, days from the first overdue day to the first logged contact with the customer.</li>
          <li><strong>Opening overdue balance</strong>: balances past due at the end of the day before the period, using payments dated up to then. <strong>Collected against it</strong>: allocations to those invoices from payments dated in the period.</li>
          <li><strong>Overdue amounts recovered</strong>: all allocations from payments dated in the period to invoices whose due date was before the payment date.</li>
          <li><strong>Promise outcomes</strong>: promises whose promised date falls in the period, judged against actual allocated payments. Promises are never counted as cash.</li>
          <li><strong>On time</strong>: follow-ups due in the period and completed on or before their due date (cancelled ones excluded).</li>
        </ul>
        <Notice tone="info">Percentages are omitted when the denominator is zero.</Notice>
      </Card>
    </>
  );
}

async function Productivity({ ctx, sp }: { ctx: TenantContext; sp: Record<string, string | undefined> }) {
  const period = resolvePeriod(ctx.today, sp.period, sp.from, sp.to);
  const p = await followUpProductivity(ctx, period);
  return (
    <>
      <div className="mb-4"><PeriodFilter period={period} basePath="/reports/productivity" /></div>
      <p className="mb-3 text-[13px] text-muted">Follow-ups with a due date in {period.label}. Use this for accountability on commitments, not to reward raw activity counts.</p>
      <Card padded={false}>
        <Table>
          <thead><tr><Th>Employee</Th><Th>Role</Th><Th align="right">Due</Th><Th align="right">On time</Th><Th align="right">Late</Th><Th align="right">Missed (open, past due)</Th><Th align="right">Upcoming</Th><Th align="right">Escalations</Th><Th align="right">Contacts logged</Th></tr></thead>
          <tbody>
            {p.rows.map((r) => (
              <tr key={r.userId}>
                <Td className="font-medium">{r.name}</Td>
                <Td>{ROLE_LABELS[r.role]}</Td>
                <Td align="right">{r.due}</Td>
                <Td align="right">{r.completedOnTime}{r.due > 0 && <span className="block text-[12px] text-muted">{pct(r.completedOnTime / r.due)}</span>}</Td>
                <Td align="right">{r.completedLate}</Td>
                <Td align="right" className={r.missed ? "font-semibold text-bad" : ""}>{r.missed}</Td>
                <Td align="right">{r.pending}</Td>
                <Td align="right">{r.escalated}</Td>
                <Td align="right">{r.communications}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {p.unassignedDue > 0 && <p className="px-4 py-2 text-[13px] text-warn">{p.unassignedDue} follow-ups in this period have no assignee.</p>}
      </Card>
    </>
  );
}

async function CashFlow({ ctx }: { ctx: TenantContext }) {
  const c = await cashFlowOutlook(ctx);
  return (
    <>
      <div className="mb-4"><Notice tone="warn" title="Operational forecast">Built from due dates and planned payments. Customers may pay late; nothing here is a guarantee or a bank balance. Overdue amounts are shown separately because their timing is uncertain.</Notice></div>
      <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <Card title="Next 7 / 14 / 30 days">
          <CashFlowChart data={c.horizons.map((h) => ({ label: `${h.days} days`, incoming: chartRupees(h.expectedIn), outgoing: chartRupees(h.plannedOut + h.otherPayables) }))} />
        </Card>
        <Card title="Breakdown" padded={false}>
          <Table>
            <thead><tr><Th>Through</Th><Th align="right">Expected collections</Th><Th align="right">Scheduled payments</Th><Th align="right">Other bills due</Th><Th align="right">Net expected</Th></tr></thead>
            <tbody>
              {c.horizons.map((h) => (
                <tr key={h.days}>
                  <Td>{h.days} days<span className="block text-[12px] text-muted">to {formatDate(h.end)}</span></Td>
                  <Td align="right"><Money value={h.expectedIn} /><span className="block text-[12px] text-muted">promised: {formatINR(h.promised)}</span></Td>
                  <Td align="right"><Money value={h.plannedOut} /></Td>
                  <Td align="right"><Money value={h.otherPayables} /></Td>
                  <Td align="right" className={h.net < 0n ? "font-semibold text-bad" : "font-semibold text-ok"}><Money value={h.net} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Overdue incoming (uncertain timing)" tone="bad" value={<Money value={c.overdueIn} />} href="/receivables?filter=overdue" />
        <Stat label="Overdue outgoing" tone="bad" value={<Money value={c.overdueOut} />} href="/payables?filter=overdue" />
        <Stat label="Actually received, last 30 days" tone="ok" value={<Money value={c.actual30.received} />} />
        <Stat label="Actually paid, last 30 days" value={<Money value={c.actual30.paid} />} />
      </div>
      <p className="mt-3 text-[12.5px] text-muted">Expected collections = receivable balances due from today through the horizon. Scheduled payments = planned supplier payments in the horizon. Other bills due = bill balances due in the horizon not already covered by a plan. Net = collections − payments − other bills due.</p>
    </>
  );
}
