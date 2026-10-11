import Link from "next/link";
import { Phone } from "lucide-react";
import { requireTenant } from "@/server/context";
import { dashboardMetrics, resolvePeriod, upcomingObligations, recentActivity, ageingReport, collectionsEffectiveness } from "@/server/queries/reports";
import { collectionsQueue } from "@/server/queries/collections";
import { Card, PageHeader, Stat, Table, Td, Th, Badge, EmptyState, LinkButton, Notice } from "@/components/ui";
import { DateText, DaysLabel, Money, PromiseBadge, PRIORITY_TONE, DateTimeText } from "@/components/format";
import { PeriodFilter } from "@/components/PeriodFilter";
import { AgeingChart } from "@/components/charts";
import { AGEING_BUCKETS } from "@/domain/ageing";
import { formatINR } from "@/domain/money";
import { chartRupees, pct } from "@/lib/display";
import { formatDate } from "@/domain/dates";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireTenant();
  const sp = await searchParams;
  const period = resolvePeriod(ctx.today, sp.period, sp.from, sp.to);
  const canR = ctx.permissions.has("receivables.view");
  const canP = ctx.permissions.has("payables.view");
  const [m, upcoming, activity, queue, ageR, ageP, eff] = await Promise.all([
    dashboardMetrics(ctx, period),
    upcomingObligations(ctx, 14),
    recentActivity(ctx, 12),
    canR ? collectionsQueue(ctx) : Promise.resolve([]),
    canR && ctx.permissions.has("reports.view") ? ageingReport(ctx, "receivable", ctx.today) : Promise.resolve(null),
    canP && ctx.permissions.has("reports.view") ? ageingReport(ctx, "payable", ctx.today) : Promise.resolve(null),
    canR ? collectionsEffectiveness(ctx, period) : Promise.resolve(null),
  ]);
  const r = m.receivables;
  const p = m.payables;
  const empty = (r?.outstandingCount ?? 0) === 0 && (p?.outstandingCount ?? 0) === 0 && queue.length === 0;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`As of ${formatDate(ctx.today)} (${ctx.timezone}). Balances are live; collections and payments are for the selected period: ${period.label}.`}
        actions={<PeriodFilter period={period} basePath="/dashboard" />}
      />
      {ctx.isDemo && <div className="mb-4"><Notice tone="warn" title="Demo mode">This business contains generated, fictional data for evaluation. Nothing here refers to real companies or people.</Notice></div>}

      {empty && (
        <div className="mb-5">
          <EmptyState title="Nothing outstanding yet" action={<div className="flex flex-wrap justify-center gap-2">{ctx.permissions.has("receivables.manage") && <LinkButton href="/customers/new" variant="primary">Add a customer</LinkButton>}{ctx.permissions.has("imports.run") && <LinkButton href="/imports">Import from a spreadsheet</LinkButton>}</div>}>
            Add customers and invoices, or import your existing spreadsheet. The dashboard fills in from your records.
          </EmptyState>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {r && (
          <>
            <Stat label="Receivables outstanding" value={<Money value={r.outstanding} />} sub={`${r.outstandingCount} open invoices`} href="/receivables?filter=open" help="Sum of remaining balances on open (issued, not void) customer invoices." />
            <Stat label="Overdue receivables" tone={r.overdue > 0n ? "bad" : "neutral"} value={<Money value={r.overdue} />} sub={`${r.overdueCount} invoices past due date`} href="/receivables?filter=overdue" help="Balance remaining on invoices whose due date is before today. An invoice due today is not overdue." />
            <Stat label="Receivables due today" tone={r.dueToday > 0n ? "warn" : "neutral"} value={<Money value={r.dueToday} />} sub={`${r.dueTodayCount} invoices`} href="/receivables?filter=due_today" />
            <Stat label="Due in next 7 days" value={<Money value={r.due7} />} sub={`${r.due7Count} invoices (after today)`} href="/receivables?filter=not_due&sort=due" />
            <Stat label="Collected" tone="ok" value={<Money value={m.collected} />} sub={period.label.split(" (")[0]} href={`/payments?direction=received&from=${period.from}&to=${period.to}`} help="Actual payments received and recorded (not reversed) with a payment date in the period. Promises are never counted." />
          </>
        )}
        {p && (
          <>
            <Stat label="Payables outstanding" value={<Money value={p.outstanding} />} sub={`${p.outstandingCount} open bills`} href="/payables?filter=open" help="Sum of remaining balances on open supplier bills." />
            <Stat label="Overdue payables" tone={p.overdue > 0n ? "bad" : "neutral"} value={<Money value={p.overdue} />} sub={`${p.overdueCount} bills past due date`} href="/payables?filter=overdue" />
            <Stat label="Payables due today" tone={p.dueToday > 0n ? "warn" : "neutral"} value={<Money value={p.dueToday} />} sub={`${p.dueTodayCount} bills`} href="/payables?filter=due_today" />
            <Stat label="Payables due in 7 days" value={<Money value={p.due7} />} sub={`${p.due7Count} bills (after today)`} href="/payables?filter=not_due&sort=due" />
            <Stat label="Paid to suppliers" value={<Money value={m.paidOut} />} sub={period.label.split(" (")[0]} href={`/payments?direction=made&from=${period.from}&to=${period.to}`} help="Actual supplier payments recorded with a payment date in the period. Planned payments are not counted." />
          </>
        )}
      </div>

      {canR && (
        <Card className="mt-5" padded={false} title="Priority actions today" description="Ranked by transparent rules — see why each account is listed." actions={<LinkButton href="/follow-ups" size="sm">Open collections queue</LinkButton>}>
          {queue.length === 0 ? (
            <div className="p-4"><EmptyState title="No accounts need attention today">Nothing is overdue, due today, or promised today.</EmptyState></div>
          ) : (
            <Table>
              <thead>
                <tr><Th>Account</Th><Th>Invoice</Th><Th align="right">Outstanding</Th><Th>Due</Th><Th>Last contact</Th><Th>Next action</Th><Th>Promise</Th><Th>Assigned</Th><Th>Recommended</Th></tr>
              </thead>
              <tbody>
                {queue.slice(0, 10).map((q) => (
                  <tr key={q.counterpartyId} className="hover:bg-[#fbfbf8]">
                    <Td>
                      <Link href={`/customers/${q.counterpartyId}`} className="font-medium text-ink hover:underline">{q.name}</Link>
                      <div className="mt-0.5 flex items-center gap-1.5"><Badge tone={PRIORITY_TONE[q.priority.band]}>{q.priority.band} · {q.priority.score}</Badge>{q.phone && <a href={`tel:${q.phone.replace(/\s/g, "")}`} className="inline-flex items-center gap-1 text-[12px] text-accent hover:underline"><Phone className="h-3 w-3" />Call</a>}</div>
                    </Td>
                    <Td>{q.leadInvoice ? <Link href={`/receivables/${q.leadInvoice.id}`} className="hover:underline">{q.leadInvoice.invoiceNumber}</Link> : "—"}{q.invoiceCount > 1 && <span className="block text-[12px] text-muted">+{q.invoiceCount - 1} more</span>}</Td>
                    <Td align="right"><Money value={q.outstanding} />{q.overdue > 0n && <span className="block text-[12px] text-bad"><Money value={q.overdue} /> overdue</span>}</Td>
                    <Td>{q.leadInvoice ? <><DateText value={q.leadInvoice.dueDate} /><span className="block text-[12px]"><DaysLabel days={q.leadInvoice.daysPastDue} /></span></> : "—"}</Td>
                    <Td>{q.lastContact ? <DateTimeText value={q.lastContact} tz={ctx.timezone} /> : <span className="font-medium text-bad">Never</span>}</Td>
                    <Td>{q.nextFollowUp ? <DateText value={q.nextFollowUp.date} /> : <span className="text-muted">None</span>}</Td>
                    <Td>{q.promise ? <><PromiseBadge status={q.promise.status} date={q.promise.date} today={ctx.today} /><span className="block text-[12px] text-muted"><Money value={q.promise.amount} /> · <DateText value={q.promise.date} /></span></> : "—"}</Td>
                    <Td>{q.assigneeName ?? <span className="text-muted">Unassigned</span>}</Td>
                    <Td className="max-w-[260px]"><span className="font-medium">{q.priority.recommendedAction}</span><span className="block text-[12px] text-muted">{q.priority.reasons.slice(0, 2).map((x) => x.text).join(" · ")}</span></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        {(ageR || ageP) && (
          <Card title="Ageing overview" description={`Outstanding by days past due, as of ${formatDate(ctx.today)}`} actions={<LinkButton href="/reports/receivables-ageing" size="sm">Full report</LinkButton>}>
            <AgeingChart
              showPayables={!!ageP}
              data={AGEING_BUCKETS.map((b) => ({ bucket: b.label, receivables: ageR ? chartRupees(ageR.totals[b.key]) : 0, payables: ageP ? chartRupees(ageP.totals[b.key]) : 0 }))}
            />
          </Card>
        )}
        <Card title="Upcoming obligations" description="Next 14 days, including today" padded={false}>
          {upcoming.length === 0 ? (
            <p className="p-4 text-[13.5px] text-muted">Nothing falls due in the next 14 days.</p>
          ) : (
            <ul className="divide-y divide-line">
              {upcoming.map((u) => (
                <li key={u.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <Link href={`/${u.direction === "receivable" ? "receivables" : "payables"}/${u.id}`} className="truncate font-medium hover:underline">{u.name}</Link>
                    <p className="text-[12.5px] text-muted">
                      <Badge tone={u.direction === "receivable" ? "accent" : "warn"}>{u.direction === "receivable" ? "Incoming" : "Outgoing"}</Badge> {u.invoiceNumber}
                      {u.planned && <> · payment planned <DateText value={u.planned} /></>}
                    </p>
                  </div>
                  <div className="text-right">
                    <Money value={u.outstanding} />
                    <p className="text-[12.5px] text-muted"><DateText value={u.dueDate} /></p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        {eff && (
          <Card title="Collection performance" description={period.label} actions={<LinkButton href={`/reports/collections?period=${period.key}&from=${period.from}&to=${period.to}`} size="sm">Details & definitions</LinkButton>}>
            {eff.overdueAccounts === 0 && eff.promises.recorded === 0 && eff.followUps.due === 0 ? (
              <p className="text-[13.5px] text-muted">Not enough activity in this period to report performance.</p>
            ) : (
              <dl className="grid gap-4 sm:grid-cols-2">
                <Metric label="Overdue accounts contacted" value={eff.overdueAccounts ? `${eff.contactedAccounts} of ${eff.overdueAccounts}` : "No overdue accounts"} sub={eff.overdueAccounts ? pct(eff.contactedAccounts / eff.overdueAccounts) : undefined} />
                <Metric label="Overdue → first contact" value={eff.firstContact.n ? `${eff.firstContact.avg!.toFixed(1)} days avg` : "No data"} sub={eff.firstContact.n ? `median ${eff.firstContact.median}d · ${eff.firstContact.n} invoices${eff.firstContact.notYetContacted ? ` · ${eff.firstContact.notYetContacted} not yet contacted` : ""}` : eff.firstContact.notYetContacted ? `${eff.firstContact.notYetContacted} newly overdue invoices not yet contacted` : undefined} />
                <Metric label="Promises kept / broken" value={eff.promises.kept + eff.promises.broken + eff.promises.partiallyKept ? `${eff.promises.kept} kept · ${eff.promises.broken} broken` : "No promises due"} sub={eff.promises.partiallyKept ? `${eff.promises.partiallyKept} partially kept` : `${eff.promises.recorded} recorded in period`} />
                <Metric label="Overdue balance recovered" value={formatINR(eff.recoveredOverdue)} sub="payments in period applied to past-due invoices" />
                <Metric label="Follow-ups completed on time" value={eff.followUps.due ? `${eff.followUps.completedOnTime} of ${eff.followUps.due}` : "None due"} sub={eff.followUps.due ? pct(eff.followUps.completedOnTime / eff.followUps.due) : undefined} />
              </dl>
            )}
          </Card>
        )}
        <Card title="Recent activity" padded={false}>
          {activity.length === 0 ? (
            <p className="p-4 text-[13.5px] text-muted">No activity recorded yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {activity.map((a) => (
                <li key={a.id} className="px-4 py-2.5 text-[13.5px]">
                  <p className="text-ink">{a.summary}</p>
                  <p className="text-[12px] text-muted">{a.actor} · <DateTimeText value={a.createdAt} tz={ctx.timezone} /></p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <dt className="text-[12.5px] font-medium text-muted">{label}</dt>
      <dd className="num mt-0.5 text-[17px] font-semibold">{value}</dd>
      {sub && <dd className="text-[12.5px] text-muted">{sub}</dd>}
    </div>
  );
}
