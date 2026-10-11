import Link from "next/link";
import { Phone } from "lucide-react";
import { requireTenant } from "@/server/context";
import { collectionsQueue, followUpTasks, promiseList, disputeList } from "@/server/queries/collections";
import { memberOptions } from "@/server/queries/counterparties";
import { openInvoicesFor } from "@/server/queries/invoices";
import { Badge, Card, EmptyState, Help, PageHeader, Table, Td, Th } from "@/components/ui";
import { DateText, DateTimeText, DaysLabel, Money, PromiseBadge, PRIORITY_TONE } from "@/components/format";
import { FilterChips } from "@/components/ListControls";
import { ConfirmAction } from "@/components/forms";
import { LogCallDialog, PromiseDialog, CompleteFollowUpDialog, RescheduleDialog, ReviewPromiseDialog, DisputeUpdateDialog, type InvoiceOption } from "@/components/collections/Dialogs";
import { cancelFollowUpAction, cancelPromiseAction } from "@/actions/collections";
import { formatINR, fromDecimal } from "@/domain/money";
import { formatDate, fromDbDate } from "@/domain/dates";
import { OUTCOME_LABELS } from "@/lib/display";
import { cn } from "@/lib/cn";

export const metadata = { title: "Follow-ups" };

const TABS = [
  { key: "", label: "Today's queue" },
  { key: "tasks", label: "Tasks" },
  { key: "promises", label: "Promises" },
  { key: "disputes", label: "Disputes" },
];

export default async function FollowUpsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireTenant("collections.work");
  const sp = await searchParams;
  const tab = sp.tab ?? "";
  const members = await memberOptions(ctx);
  return (
    <>
      <PageHeader title="Follow-ups" description="Who to contact first today, and why. Calls are the main action; messages support them." />
      <div className="mb-4 flex flex-wrap gap-1 border-b border-line" role="tablist">
        {TABS.map((t) => (
          <Link key={t.key} role="tab" aria-selected={tab === t.key} href={t.key ? `/follow-ups?tab=${t.key}` : "/follow-ups"} className={cn("-mb-px border-b-2 px-3 py-2 text-[14px] font-medium", tab === t.key ? "border-accent text-accent-strong" : "border-transparent text-muted hover:text-ink")}>
            {t.label}
          </Link>
        ))}
      </div>
      {tab === "" && <Queue ctx={ctx} sp={sp} members={members} />}
      {tab === "tasks" && <Tasks ctx={ctx} sp={sp} members={members} />}
      {tab === "promises" && <Promises ctx={ctx} sp={sp} />}
      {tab === "disputes" && <Disputes ctx={ctx} sp={sp} />}
    </>
  );
}

type Ctx = Awaited<ReturnType<typeof requireTenant>>;

async function Queue({ ctx, sp, members }: { ctx: Ctx; sp: Record<string, string | undefined>; members: { id: string; name: string }[] }) {
  const rows = await collectionsQueue(ctx, { band: sp.band, minDays: sp.minDays, minAmount: sp.minAmount, assignee: sp.assignee === "me" ? ctx.userId : sp.assignee, promise: sp.promise, dispute: sp.dispute, contact: sp.contact, q: sp.q });
  const invoicesByCp = new Map<string, InvoiceOption[]>();
  await Promise.all(
    rows.slice(0, 40).map(async (r) => {
      const open = await openInvoicesFor(ctx, r.counterpartyId, "receivable");
      invoicesByCp.set(r.counterpartyId, open.map((o) => ({ id: o.id, invoiceNumber: o.invoiceNumber, outstanding: formatINR(o.outstanding, { symbol: false }), dueDate: formatDate(o.dueDate) })));
    }),
  );
  return (
    <>
      <form className="no-print mb-4 grid gap-2 rounded-lg border border-line bg-surface p-3 sm:grid-cols-3 lg:grid-cols-8">
        <input name="q" defaultValue={sp.q} placeholder="Customer" aria-label="Customer" className="h-9 rounded-md border border-line-strong px-3 text-[13.5px] lg:col-span-2" />
        <select name="band" defaultValue={sp.band ?? ""} aria-label="Priority" className="h-9 rounded-md border border-line-strong bg-surface px-2 text-[13.5px]"><option value="">Any priority</option><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>
        <select name="minDays" defaultValue={sp.minDays ?? ""} aria-label="Days overdue" className="h-9 rounded-md border border-line-strong bg-surface px-2 text-[13.5px]"><option value="">Any days overdue</option><option value="1">1+ days</option><option value="31">31+ days</option><option value="61">61+ days</option><option value="91">91+ days</option></select>
        <input name="minAmount" defaultValue={sp.minAmount} inputMode="decimal" placeholder="Min ₹ overdue" aria-label="Minimum amount" className="h-9 rounded-md border border-line-strong px-2 text-[13.5px]" />
        <select name="assignee" defaultValue={sp.assignee ?? ""} aria-label="Assigned" className="h-9 rounded-md border border-line-strong bg-surface px-2 text-[13.5px]"><option value="">Anyone</option><option value="me">Assigned to me</option><option value="unassigned">Unassigned</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
        <select name="contact" defaultValue={sp.contact ?? ""} aria-label="Last contact" className="h-9 rounded-md border border-line-strong bg-surface px-2 text-[13.5px]"><option value="">Any last contact</option><option value="never">Never contacted</option><option value="7">Not in 7+ days</option><option value="14">Not in 14+ days</option></select>
        <div className="flex gap-2">
          <select name="promise" defaultValue={sp.promise ?? ""} aria-label="Promise status" className="h-9 min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-2 text-[13.5px]"><option value="">Any promise</option><option value="due_today">Promise due</option><option value="broken">Broken promise</option><option value="none">No promise</option></select>
        </div>
        <select name="dispute" defaultValue={sp.dispute ?? ""} aria-label="Dispute status" className="h-9 rounded-md border border-line-strong bg-surface px-2 text-[13.5px]"><option value="">Any dispute status</option><option value="open">Has open dispute</option><option value="none">No dispute</option></select>
        <button className="h-9 rounded-md bg-ink px-3 text-[13.5px] font-medium text-white">Filter</button>
        <Link href="/follow-ups" className="flex h-9 items-center justify-center rounded-md border border-line-strong px-3 text-[13.5px]">Reset</Link>
      </form>
      <p className="mb-2 flex items-center gap-1 text-[12.5px] text-muted">
        {rows.length} account{rows.length === 1 ? "" : "s"} need attention.
        <Help text="Score = days overdue + amount band + promise due/broken + never contacted / time since contact + missed follow-ups, minus points when a follow-up is already scheduled or a documented dispute hold applies. Weights are configurable in Settings → Financial." />
      </p>
      {rows.length === 0 ? (
        <EmptyState title="Queue is clear">Nothing is overdue, due today, promised today or awaiting a scheduled follow-up{Object.keys(sp).length ? " for these filters" : ""}.</EmptyState>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <Card key={r.counterpartyId} className={r.priority.band === "critical" ? "border-[#f0c9c4]" : ""}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={PRIORITY_TONE[r.priority.band]}>{r.priority.band} · {r.priority.score}</Badge>
                    <Link href={`/customers/${r.counterpartyId}`} className="text-[15px] font-semibold hover:underline">{r.name}</Link>
                    {r.onHold && <Badge tone="warn">Dispute hold</Badge>}
                    {!r.onHold && r.openDisputes > 0 && <Badge tone="warn">{r.openDisputes} open dispute{r.openDisputes > 1 ? "s" : ""}</Badge>}
                    {r.brokenPromises > 0 && <Badge tone="bad">{r.brokenPromises} broken promise{r.brokenPromises > 1 ? "s" : ""}</Badge>}
                  </div>
                  <p className="mt-1 text-[13.5px]"><span className="font-semibold">Next: {r.priority.recommendedAction}</span></p>
                  <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[12.5px] text-muted">
                    {r.priority.reasons.map((x, i) => <li key={i}>{x.points > 0 ? "+" : ""}{x.points} {x.text}</li>)}
                  </ul>
                </div>
                <div className="text-right">
                  <p className="text-[12px] text-muted">Overdue / outstanding</p>
                  <p className="num text-[17px] font-semibold"><Money value={r.overdue} tone="bad" /> <span className="text-[13px] font-normal text-muted">/ <Money value={r.outstanding} /></span></p>
                </div>
              </div>
              <div className="mt-3 grid gap-3 text-[13px] sm:grid-cols-2 lg:grid-cols-5">
                <Info label="Oldest open invoice">{r.leadInvoice ? <><Link href={`/receivables/${r.leadInvoice.id}`} className="text-accent hover:underline">{r.leadInvoice.invoiceNumber}</Link> · <DaysLabel days={r.leadInvoice.daysPastDue} /><span className="block text-muted">{[r.leadInvoice.poReference && `PO ${r.leadInvoice.poReference}`, r.leadInvoice.deliveryReference && `DC ${r.leadInvoice.deliveryReference}`].filter(Boolean).join(" · ") || "No PO/DC reference"}</span></> : "—"}</Info>
                <Info label="Last contact">{r.lastContact ? <><DateTimeText value={r.lastContact} tz={ctx.timezone} />{r.lastOutcome && <span className="block text-muted">{OUTCOME_LABELS[r.lastOutcome]}</span>}</> : <span className="font-semibold text-bad">Never contacted</span>}</Info>
                <Info label="Promise">{r.promise ? <><PromiseBadge status={r.promise.status} date={r.promise.date} today={ctx.today} /> <Money value={r.promise.amount} /><span className="block text-muted">for <DateText value={r.promise.date} /></span></> : "None"}</Info>
                <Info label="Next scheduled">{r.nextFollowUp ? <><DateText value={r.nextFollowUp.date} className={r.nextFollowUp.date < ctx.today ? "font-semibold text-bad" : ""} /><span className="block text-muted">{r.nextFollowUp.title}</span></> : "Nothing scheduled"}</Info>
                <Info label="Assigned">{r.assigneeName ?? "Unassigned"}{r.contactPerson && <span className="block text-muted">Contact: {r.contactPerson}</span>}</Info>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
                {r.phone && <a href={`tel:${r.phone.replace(/\s/g, "")}`} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-ok px-3 text-[13px] font-medium text-white hover:opacity-90"><Phone className="h-3.5 w-3.5" />Call {r.phone}</a>}
                <LogCallDialog counterpartyId={r.counterpartyId} invoices={invoicesByCp.get(r.counterpartyId) ?? []} defaultInvoiceIds={r.leadInvoice ? [r.leadInvoice.id] : []} followUpId={r.nextFollowUp && r.nextFollowUp.date <= ctx.today ? r.nextFollowUp.id : undefined} today={ctx.today} contactPerson={r.contactPerson} triggerLabel="Record outcome" triggerSize="sm" />
                <PromiseDialog counterpartyId={r.counterpartyId} invoices={invoicesByCp.get(r.counterpartyId) ?? []} defaultInvoiceIds={r.leadInvoice ? [r.leadInvoice.id] : []} today={ctx.today} triggerSize="sm" />
                <Link href={`/customers/${r.counterpartyId}`} className="inline-flex h-8 items-center rounded-md border border-line-strong px-3 text-[13px] font-medium hover:bg-subtle">Account history & evidence</Link>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

async function Tasks({ ctx, sp, members }: { ctx: Ctx; sp: Record<string, string | undefined>; members: { id: string; name: string }[] }) {
  const status = sp.status ?? "pending";
  const rows = await followUpTasks(ctx, { scope: sp.scope, assignee: sp.assignee, status });
  const params = { tab: "tasks", scope: sp.scope, assignee: sp.assignee, status: sp.status };
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <FilterChips path="/follow-ups" params={params} param="status" current={sp.status ?? ""} options={[{ key: "", label: "Pending" }, { key: "completed", label: "Completed" }, { key: "cancelled", label: "Cancelled" }]} />
        {status === "pending" && <FilterChips path="/follow-ups" params={params} param="scope" current={sp.scope ?? ""} options={[{ key: "", label: "All dates" }, { key: "today", label: "Due today & missed" }, { key: "upcoming", label: "Upcoming" }]} />}
        <form className="flex gap-2">
          <input type="hidden" name="tab" value="tasks" />
          {sp.status && <input type="hidden" name="status" value={sp.status} />}
          {sp.scope && <input type="hidden" name="scope" value={sp.scope} />}
          <select name="assignee" defaultValue={sp.assignee ?? ""} aria-label="Assigned" className="h-8 rounded-md border border-line-strong bg-surface px-2 text-[13px]"><option value="">Everyone</option><option value="me">Mine</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
          <button className="h-8 rounded-md border border-line-strong bg-surface px-3 text-[13px]">Apply</button>
        </form>
      </div>
      <Card padded={false}>
        {rows.length === 0 ? <div className="p-4"><EmptyState title="No follow-ups here">Schedule follow-ups from an invoice, a customer profile or after a call.</EmptyState></div> : (
          <Table>
            <thead><tr><Th>Due</Th><Th>Follow-up</Th><Th>Account / invoice</Th><Th>Assigned</Th><Th>Source</Th><Th>{status === "pending" ? "Actions" : "Outcome"}</Th></tr></thead>
            <tbody>
              {rows.map((f) => (
                <tr key={f.id} className="align-top">
                  <Td><DateText value={f.dueDate} className={status === "pending" && f.dueDateIso < ctx.today ? "font-semibold text-bad" : status === "pending" && f.dueDateIso === ctx.today ? "font-semibold text-warn" : ""} />{status === "pending" && f.dueDateIso < ctx.today && <span className="block text-[12px] text-bad">Missed</span>}</Td>
                  <Td><span className="font-medium">{f.title}</span> <Badge tone={PRIORITY_TONE[f.priority]}>{f.type.replace("_", " ")}</Badge>{f.details && <span className="block max-w-md text-[12.5px] text-muted">{f.details}</span>}</Td>
                  <Td><Link href={`/${f.counterparty.isCustomer ? "customers" : "suppliers"}/${f.counterparty.id}`} className="hover:underline">{f.counterparty.name}</Link>{f.invoice && <Link href={`/${f.invoice.direction === "receivable" ? "receivables" : "payables"}/${f.invoice.id}`} className="block text-[12.5px] text-accent hover:underline">{f.invoice.invoiceNumber}</Link>}</Td>
                  <Td>{f.assigneeName ?? <span className="text-muted">Unassigned</span>}</Td>
                  <Td className="text-[12.5px] text-muted">{f.source.replace("_", " ")}</Td>
                  <Td>
                    {status === "pending" ? (
                      <div className="flex flex-wrap gap-1">
                        {f.counterparty.phone && <a href={`tel:${f.counterparty.phone.replace(/\s/g, "")}`} className="inline-flex h-8 items-center gap-1 rounded-md border border-line-strong px-2 text-[13px] hover:bg-subtle"><Phone className="h-3.5 w-3.5" />Call</a>}
                        <LogCallDialog counterpartyId={f.counterparty.id} invoices={[]} followUpId={f.id} today={ctx.today} isCustomer={f.counterparty.isCustomer} triggerLabel="Record call" triggerVariant="subtle" triggerSize="sm" />
                        <CompleteFollowUpDialog id={f.id} />
                        <RescheduleDialog id={f.id} kind="followup" today={ctx.today} />
                        <ConfirmAction action={cancelFollowUpAction} hidden={{ id: f.id }} label="Cancel" title="Cancel follow-up?" description="It stays in history as cancelled." reasonLabel="Reason" variant="ghost" />
                      </div>
                    ) : (
                      <span className="text-[12.5px]">{f.completionNote ?? "—"}<span className="block text-muted">{f.completedAt && <DateTimeText value={f.completedAt} tz={ctx.timezone} />}</span></span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

async function Promises({ ctx, sp }: { ctx: Ctx; sp: Record<string, string | undefined> }) {
  const status = sp.status ?? "upcoming";
  const rows = await promiseList(ctx, status);
  const params = { tab: "promises", status: sp.status };
  return (
    <>
      <div className="mb-3"><FilterChips path="/follow-ups" params={params} param="status" current={sp.status ?? ""} options={[{ key: "", label: "Upcoming" }, { key: "broken", label: "Broken" }, { key: "partially_kept", label: "Partially kept" }, { key: "kept", label: "Kept" }, { key: "review", label: "Needs review" }, { key: "cancelled", label: "Cancelled" }, { key: "all", label: "All" }]} /></div>
      <p className="mb-2 text-[12.5px] text-muted">Outcomes are judged against payments actually allocated to the promised invoices by the promised date — never by time passing alone.</p>
      <Card padded={false}>
        {rows.length === 0 ? <div className="p-4"><EmptyState title="No promises in this view" /></div> : (
          <Table>
            <thead><tr><Th>Customer</Th><Th>Promised date</Th><Th align="right">Amount</Th><Th align="right">Received by date</Th><Th>Outcome</Th><Th>Invoices</Th><Th>Reason</Th><Th /></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <Td><Link href={`/customers/${p.counterparty.id}`} className="font-medium hover:underline">{p.counterparty.name}</Link></Td>
                  <Td><DateText value={p.promisedIso} /></Td>
                  <Td align="right"><Money value={p.amountP} /></Td>
                  <Td align="right">{p.status === "upcoming" ? "—" : <Money value={p.receivedP} />}</Td>
                  <Td><PromiseBadge status={p.status} date={p.promisedIso} today={ctx.today} />{p.needsReview && <Badge tone="warn" className="ml-1">Review</Badge>}</Td>
                  <Td className="text-[12.5px]">{p.invoices.map((i) => <Link key={i.invoice.id} href={`/receivables/${i.invoice.id}`} className="mr-1 text-accent hover:underline">{i.invoice.invoiceNumber}</Link>)}{p.invoices.length === 0 && "Any open"}</Td>
                  <Td className="max-w-[220px] text-[12.5px] text-muted">{p.reason ?? "—"}</Td>
                  <Td>
                    {p.status === "upcoming" && <ConfirmAction action={cancelPromiseAction} hidden={{ id: p.id }} label="Cancel" title="Cancel promise?" description="Record why the commitment no longer applies." reasonLabel="Reason" variant="ghost" />}
                    {p.needsReview && <ReviewPromiseDialog id={p.id} partial={p.status === "partially_kept"} today={ctx.today} />}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

async function Disputes({ ctx, sp }: { ctx: Ctx; sp: Record<string, string | undefined> }) {
  const rows = await disputeList(ctx, sp.status);
  return (
    <>
      <div className="mb-3"><FilterChips path="/follow-ups" params={{ tab: "disputes", status: sp.status }} param="status" current={sp.status ?? ""} options={[{ key: "", label: "Open" }, { key: "closed", label: "Resolved / closed" }, { key: "all", label: "All" }]} /></div>
      <Card padded={false}>
        {rows.length === 0 ? <div className="p-4"><EmptyState title="No disputes in this view" /></div> : (
          <Table>
            <thead><tr><Th>Raised</Th><Th>Account</Th><Th>Invoice</Th><Th>Category</Th><Th align="right">Outstanding</Th><Th>Status</Th><Th>Description</Th><Th /></tr></thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id}>
                  <Td><DateText value={d.raisedOn} /></Td>
                  <Td><Link href={`/${d.invoice.direction === "receivable" ? "customers" : "suppliers"}/${d.counterparty.id}`} className="hover:underline">{d.counterparty.name}</Link></Td>
                  <Td><Link href={`/${d.invoice.direction === "receivable" ? "receivables" : "payables"}/${d.invoice.id}`} className="text-accent hover:underline">{d.invoice.invoiceNumber}</Link><span className="block text-[12px]"><DaysLabel days={fromDecimal(d.invoice.outstandingAmount) > 0n ? Math.round((Date.parse(ctx.today) - Date.parse(fromDbDate(d.invoice.dueDate))) / 86400000) : null} /></span></Td>
                  <Td>{d.category.replace(/_/g, " ")}</Td>
                  <Td align="right"><Money value={fromDecimal(d.invoice.outstandingAmount)} /></Td>
                  <Td><Badge tone={d.status === "resolved" || d.status === "closed" ? "ok" : "warn"}>{d.status.replace(/_/g, " ")}</Badge>{d.collectionHold && <span className="block text-[12px] text-warn">Collections on hold</span>}</Td>
                  <Td className="max-w-[260px] text-[12.5px] text-muted">{d.description}</Td>
                  <Td><DisputeUpdateDialog disputeId={d.id} status={d.status} hold={d.collectionHold} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
