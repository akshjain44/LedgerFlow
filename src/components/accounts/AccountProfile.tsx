import Link from "next/link";
import { notFound } from "next/navigation";
import { Phone, Mail, Printer } from "lucide-react";
import type { TenantContext } from "@/server/context";
import { getCounterpartyProfile, memberOptions } from "@/server/queries/counterparties";
import { customerBehaviour } from "@/server/queries/reports";
import { openInvoicesFor } from "@/server/queries/invoices";
import { NotFoundError } from "@/server/errors";
import { signDocumentUrl } from "@/server/storage";
import { Badge, Card, Dl, LinkButton, Notice, PageHeader, Stat, Table, Td, Th } from "@/components/ui";
import { DateText, DateTimeText, DaysLabel, Money, PromiseBadge, StatusBadge } from "@/components/format";
import { FollowUpDialog, LogCallDialog, MessageDialog, PromiseDialog, UploadDialog, CompleteFollowUpDialog, type InvoiceOption } from "@/components/collections/Dialogs";
import { fromDecimal, formatINR } from "@/domain/money";
import { diffDays, formatDate, fromDbDate } from "@/domain/dates";
import { displayStatus } from "@/domain/invoiceStatus";
import { OUTCOME_LABELS, pct } from "@/lib/display";

export async function AccountProfile({ ctx, id, kind }: { ctx: TenantContext; id: string; kind: "customer" | "supplier" }) {
  const data = await getCounterpartyProfile(ctx, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const { cp, totals, userName } = data;
  if ((kind === "customer" && !data.canR) || (kind === "supplier" && !data.canP)) notFound();
  const recv = kind === "customer";
  const direction = recv ? "receivable" : "payable";
  const [members, open, behaviour] = await Promise.all([memberOptions(ctx), openInvoicesFor(ctx, id, direction), recv ? customerBehaviour(ctx, id) : Promise.resolve(null)]);
  const opts: InvoiceOption[] = open.map((o) => ({ id: o.id, invoiceNumber: o.invoiceNumber, outstanding: formatINR(o.outstanding, { symbol: false }), dueDate: formatDate(o.dueDate) }));
  const invoices = data.invoices.filter((i) => i.direction === direction);
  const openInvoices = invoices.filter((i) => i.lifecycle === "open" && fromDecimal(i.outstandingAmount) > 0n);
  const payments = data.payments.filter((p) => p.direction === (recv ? "received" : "made"));
  const pendingFollowUps = data.followUps.filter((f) => f.status === "pending");
  const can = (p: Parameters<typeof ctx.permissions.has>[0]) => ctx.permissions.has(p);
  const outstanding = recv ? totals.receivable : totals.payable;
  const overdue = recv ? totals.receivableOverdue : totals.payableOverdue;
  const unallocated = recv ? totals.unallocatedReceived : totals.unallocatedMade;
  const otherSide = recv ? (cp.isSupplier && ctx.permissions.has("payables.view") ? `/suppliers/${cp.id}` : null) : cp.isCustomer && ctx.permissions.has("receivables.view") ? `/customers/${cp.id}` : null;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ href: `/${kind}s`, label: recv ? "Customers" : "Suppliers" }, { label: cp.name }]}
        title={<span className="flex flex-wrap items-center gap-2">{cp.name} <Badge tone={cp.status === "active" ? "ok" : cp.status === "on_hold" ? "warn" : "neutral"}>{cp.status.replace("_", " ")}</Badge>{cp.isCustomer && cp.isSupplier && <Badge tone="info">Customer & supplier</Badge>}</span>}
        description={
          <span className="flex flex-wrap gap-x-3 gap-y-1">
            {cp.contactPerson && <span>{cp.contactPerson}</span>}
            {cp.phone && <a href={`tel:${cp.phone.replace(/\s/g, "")}`} className="inline-flex items-center gap-1 text-accent hover:underline"><Phone className="h-3.5 w-3.5" />{cp.phone}</a>}
            {cp.email && <a href={`mailto:${cp.email}`} className="inline-flex items-center gap-1 text-accent hover:underline"><Mail className="h-3.5 w-3.5" />{cp.email}</a>}
            {otherSide && <Link href={otherSide} className="text-accent hover:underline">View as {recv ? "supplier" : "customer"} →</Link>}
          </span>
        }
        actions={
          <>
            {can("collections.work") && <LogCallDialog counterpartyId={cp.id} invoices={opts} today={ctx.today} isCustomer={recv} contactPerson={cp.contactPerson} triggerLabel={recv ? "Record call" : "Record communication"} />}
            {recv && can("collections.work") && openInvoices.length > 0 && <PromiseDialog counterpartyId={cp.id} invoices={opts} today={ctx.today} />}
            {can("payments.record") && <LinkButton href={`/payments/new?direction=${recv ? "received" : "made"}&counterpartyId=${cp.id}&returnTo=/${kind}s/${cp.id}`}>Record payment</LinkButton>}
            {can(recv ? "receivables.manage" : "payables.manage") && <LinkButton href={`/${recv ? "receivables" : "payables"}/new?counterpartyId=${cp.id}`}>{recv ? "New invoice" : "New bill"}</LinkButton>}
            <LinkButton href={`/${kind}s/${cp.id}/statement`}><Printer className="h-4 w-4" />Statement</LinkButton>
            {can(recv ? "receivables.manage" : "payables.manage") && <LinkButton href={`/${kind}s/${cp.id}/edit`} variant="ghost">Edit</LinkButton>}
          </>
        }
      />
      {ctx.isDemo && <div className="mb-4"><Notice tone="warn">Fictional demo account.</Notice></div>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label={recv ? "Total outstanding" : "Total payable"} value={<Money value={outstanding} />} sub={`${openInvoices.length} open ${recv ? "invoices" : "bills"}`} />
        <Stat label="Overdue" tone={overdue > 0n ? "bad" : "neutral"} value={<Money value={overdue} />} />
        <Stat label="Unallocated payments" tone={unallocated > 0n ? "warn" : "neutral"} value={<Money value={unallocated} />} sub={unallocated > 0n ? "Allocate from Payments" : undefined} help="Payments recorded but not yet applied to a specific invoice. They do not reduce any invoice balance until allocated." />
        <Stat label={recv ? "Next follow-up" : "Next planned payment"} value={recv ? (pendingFollowUps[0] ? formatDate(pendingFollowUps[0].dueDate) : "None") : data.planned[0] ? formatDate(data.planned[0].plannedDate) : "None"} sub={recv ? pendingFollowUps[0]?.title : data.planned[0] ? `${formatINR(fromDecimal(data.planned[0].amount))} · ${data.planned[0].invoice.invoiceNumber}` : undefined} />
        <Stat label="Credit terms" value={`${(recv ? cp.customerCreditDays : cp.supplierCreditDays) ?? "Default"} days`} sub={cp.creditLimit ? `Approved limit ${formatINR(fromDecimal(cp.creditLimit))}` : cp.paymentTerms ?? "No limit set"} />
      </div>

      {behaviour && (
        <Card className="mt-5" title="Payment behaviour" description="Observed facts from recorded invoices, payments and promises. Not a judgement of intent, fraud or solvency.">
          {!behaviour.sufficient ? (
            <p className="text-[13.5px] text-muted">Insufficient history: {behaviour.settledCount} settled invoice{behaviour.settledCount === 1 ? "" : "s"} (at least 3 needed for averages).</p>
          ) : (
            <Dl cols={4} items={[
              ["Average payment timing", behaviour.avgDelay! > 0 ? `${behaviour.avgDelay!.toFixed(1)} days after due date` : behaviour.avgDelay! < 0 ? `${(-behaviour.avgDelay!).toFixed(1)} days before due date` : "On the due date"],
              ["Settled late", `${pct(behaviour.lateShare)} of ${behaviour.settledCount} settled invoices`],
              ["Recent change", behaviour.trend === null ? "Not enough history (6 settled invoices needed)" : behaviour.trend > 0 ? `Last 3 paid ${behaviour.trend.toFixed(0)} days later than earlier average` : `Last 3 paid ${(-behaviour.trend).toFixed(0)} days earlier than earlier average`],
              ["Typical invoice", behaviour.avgInvoice !== null ? formatINR(behaviour.avgInvoice) : "—"],
            ]} />
          )}
          <div className="mt-3 grid gap-3 text-[13.5px] sm:grid-cols-3">
            <p>Broken promises: <strong>{behaviour.brokenTotal}</strong> total, {behaviour.brokenWindow} in review window</p>
            <p>Promises kept: <strong>{behaviour.kept}</strong></p>
            <p>Open disputes: <strong>{behaviour.openDisputes}</strong></p>
          </div>
          {behaviour.suggestions.length > 0 && (
            <div className="mt-4 rounded-lg border border-[#f0dcb4] bg-warn-soft/60 p-3">
              <p className="text-[13px] font-semibold text-warn">Credit review prompts (for an authorised person to decide)</p>
              <ul className="mt-1 space-y-1 text-[13.5px]">
                {behaviour.suggestions.map((s, i) => <li key={i}>• {s.text} <span className="text-muted">— {s.basis}</span></li>)}
              </ul>
            </div>
          )}
        </Card>
      )}

      <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_380px]">
        <div className="min-w-0 space-y-5">
          <Card title={recv ? "Invoices" : "Bills"} padded={false} actions={<LinkButton size="sm" href={`/${recv ? "receivables" : "payables"}?counterpartyId=${cp.id}&filter=all`}>All</LinkButton>}>
            {invoices.length === 0 ? <p className="p-4 text-[13.5px] text-muted">None yet.</p> : (
              <Table>
                <thead><tr><Th>Number</Th><Th>Date</Th><Th>Due</Th><Th align="right">Total</Th><Th align="right">Outstanding</Th><Th>Status</Th><Th>References</Th></tr></thead>
                <tbody>
                  {invoices.slice(0, 30).map((i) => {
                    const facts = { lifecycle: i.lifecycle, total: fromDecimal(i.totalAmount), paid: fromDecimal(i.amountPaid), adjusted: fromDecimal(i.amountAdjusted), dueDate: fromDbDate(i.dueDate) };
                    const st = displayStatus(facts, ctx.today);
                    return (
                      <tr key={i.id} className="hover:bg-[#fbfbf8]">
                        <Td><Link href={`/${recv ? "receivables" : "payables"}/${i.id}`} className="font-medium text-accent hover:underline">{i.invoiceNumber}</Link></Td>
                        <Td><DateText value={i.invoiceDate} /></Td>
                        <Td><DateText value={i.dueDate} />{st !== "paid" && st !== "void" && <span className="block text-[12px]"><DaysLabel days={diffDays(facts.dueDate, ctx.today)} /></span>}</Td>
                        <Td align="right"><Money value={facts.total} /></Td>
                        <Td align="right" className="font-semibold"><Money value={fromDecimal(i.outstandingAmount)} /></Td>
                        <Td><div className="flex flex-wrap gap-1"><StatusBadge status={st} />{i.disputes.length > 0 && <Badge tone="warn">Disputed</Badge>}</div></Td>
                        <Td className="text-[12px] text-muted">{[i.poReference && `PO ${i.poReference}`, i.deliveryReference && `DC ${i.deliveryReference}`].filter(Boolean).join(" · ") || "—"}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Card>

          <Card title="Payment history" padded={false}>
            {payments.length === 0 ? <p className="p-4 text-[13.5px] text-muted">No payments recorded.</p> : (
              <Table>
                <thead><tr><Th>Date</Th><Th align="right">Amount</Th><Th>Method / ref</Th><Th>Applied to</Th><Th>Status</Th></tr></thead>
                <tbody>
                  {payments.slice(0, 20).map((p) => (
                    <tr key={p.id} className={p.status === "reversed" ? "text-muted" : ""}>
                      <Td><Link href={`/payments/${p.id}`} className="text-accent hover:underline"><DateText value={p.paymentDate} /></Link></Td>
                      <Td align="right"><Money value={fromDecimal(p.amount)} className={p.status === "reversed" ? "line-through" : ""} /></Td>
                      <Td>{p.method}{p.reference && <span className="block text-[12px] text-muted">{p.reference}</span>}</Td>
                      <Td className="text-[12.5px]">{p.allocations.map((a) => `${a.invoice.invoiceNumber} (${formatINR(fromDecimal(a.amount))})`).join(", ") || <span className="text-warn">Unallocated</span>}</Td>
                      <Td>{p.status === "active" ? <Badge tone="ok">Recorded</Badge> : <Badge>Reversed</Badge>}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          {recv && (
            <Card title="Promises to pay" padded={false}>
              {data.promises.length === 0 ? <p className="p-4 text-[13.5px] text-muted">No promises recorded.</p> : (
                <Table>
                  <thead><tr><Th>Promised for</Th><Th align="right">Amount</Th><Th align="right">Received by date</Th><Th>Outcome</Th><Th>Invoices</Th><Th>Logged</Th></tr></thead>
                  <tbody>
                    {data.promises.map((p) => (
                      <tr key={p.id}>
                        <Td><DateText value={p.promisedDate} /></Td>
                        <Td align="right"><Money value={fromDecimal(p.amount)} /></Td>
                        <Td align="right">{p.status === "upcoming" ? "—" : <Money value={fromDecimal(p.amountReceived)} />}</Td>
                        <Td><PromiseBadge status={p.status} date={fromDbDate(p.promisedDate)} today={ctx.today} />{p.needsReview && <Badge tone="warn" className="ml-1">Review</Badge>}</Td>
                        <Td className="text-[12.5px]">{p.invoices.map((i) => i.invoice.invoiceNumber).join(", ") || "Any open"}</Td>
                        <Td className="text-[12.5px]"><DateTimeText value={p.recordedAt} tz={ctx.timezone} />{p.reason && <span className="block text-muted">{p.reason}</span>}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
          )}

          <Card title="Account timeline" description="Calls, messages and notable events, newest first" padded={false} actions={can("collections.work") ? <MessageDialog counterpartyId={cp.id} supplier={!recv} triggerSize="sm" /> : undefined}>
            {data.comms.length === 0 && data.timelineAudit.length === 0 ? <p className="p-4 text-[13.5px] text-muted">Nothing recorded yet.</p> : (
              <ol className="max-h-[560px] divide-y divide-line overflow-y-auto">
                {[
                  ...data.comms.map((c) => ({ at: c.contactedAt, node: (
                    <div>
                      <p className="text-[13.5px]"><span className="font-medium capitalize">{c.channel}</span>{c.outcome && <> · <Badge tone="info">{OUTCOME_LABELS[c.outcome]}</Badge></>}{c.invoices.length > 0 && <span className="text-muted"> · {c.invoices.map((i) => i.invoice.invoiceNumber).join(", ")}</span>}</p>
                      {c.notes && <p className="mt-1 whitespace-pre-line text-[13.5px] text-ink-2">{c.notes}</p>}
                      <p className="mt-0.5 text-[12px] text-muted">{userName(c.createdById)} · <DateTimeText value={c.contactedAt} tz={ctx.timezone} /></p>
                    </div>
                  ) })),
                  ...data.timelineAudit.filter((a) => !a.action.startsWith("communication.")).map((a) => ({ at: a.createdAt, node: <p className="text-[13px] text-muted">{a.summary} · {userName(a.actorUserId)} · <DateTimeText value={a.createdAt} tz={ctx.timezone} /></p> })),
                ]
                  .sort((a, b) => +b.at - +a.at)
                  .slice(0, 80)
                  .map((t, i) => <li key={i} className="px-4 py-2.5">{t.node}</li>)}
              </ol>
            )}
          </Card>
        </div>

        <div className="min-w-0 space-y-5">
          <Card title="Follow-ups" padded={false} actions={can("collections.work") ? <FollowUpDialog counterpartyId={cp.id} members={members} today={ctx.today} defaultTitle={`${recv ? "Call" : "Contact"} ${cp.name}`} triggerSize="sm" /> : undefined}>
            {pendingFollowUps.length === 0 ? <p className="p-4 text-[13.5px] text-muted">Nothing scheduled.</p> : (
              <ul className="divide-y divide-line">
                {pendingFollowUps.map((f) => (
                  <li key={f.id} className="px-4 py-2.5 text-[13.5px]">
                    <p className={fromDbDate(f.dueDate) < ctx.today ? "font-semibold text-bad" : "font-medium"}><DateText value={f.dueDate} />{f.type === "escalation" && <Badge tone="bad" className="ml-1">Escalation</Badge>}</p>
                    <p>{f.title}</p>
                    {f.details && <p className="text-[12.5px] text-muted">{f.details}</p>}
                    <p className="text-[12px] text-muted">{userName(f.assignedUserId)}</p>
                    {can("collections.work") && <div className="mt-1.5 flex gap-1"><LogCallDialog counterpartyId={cp.id} invoices={opts} followUpId={f.id} today={ctx.today} isCustomer={recv} triggerLabel="Record call" triggerVariant="subtle" triggerSize="sm" /><CompleteFollowUpDialog id={f.id} /></div>}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Disputes" padded={false}>
            {data.disputes.length === 0 ? <p className="p-4 text-[13.5px] text-muted">No disputes.</p> : (
              <ul className="divide-y divide-line">
                {data.disputes.map((d) => (
                  <li key={d.id} className="px-4 py-2.5 text-[13.5px]">
                    <p><Link href={`/${d.invoice.direction === "receivable" ? "receivables" : "payables"}/${d.invoice.id}`} className="font-medium text-accent hover:underline">{d.invoice.invoiceNumber}</Link> · {d.category.replace(/_/g, " ")} <Badge tone={d.status === "resolved" || d.status === "closed" ? "ok" : "warn"}>{d.status.replace(/_/g, " ")}</Badge></p>
                    <p className="text-[12.5px] text-muted">{d.description}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {!recv && data.planned.length > 0 && (
            <Card title="Upcoming planned payments" padded={false}>
              <ul className="divide-y divide-line">
                {data.planned.map((p) => <li key={p.id} className="flex justify-between px-4 py-2.5 text-[13.5px]"><span><DateText value={p.plannedDate} /> · <Link href={`/payables/${p.invoice.id}`} className="text-accent hover:underline">{p.invoice.invoiceNumber}</Link></span><Money value={fromDecimal(p.amount)} /></li>)}
              </ul>
            </Card>
          )}

          <Card title="Details">
            <Dl items={[["Account code", cp.accountCode ?? "—"], ["GSTIN", cp.gstin ? <span key="g">{cp.gstin} <span className="text-[12px] text-muted">(not verified)</span></span> : "—"], ["Payment terms", cp.paymentTerms ?? "—"], ["Assigned", cp.assignedUserId ? userName(cp.assignedUserId) : "Unassigned"], ["Billing address", cp.billingAddress ?? "—"], ["Created", <DateText key="c" value={cp.createdAt} />]]} />
            {cp.notes && <p className="mt-3 whitespace-pre-line rounded-md bg-subtle p-2.5 text-[13px]">{cp.notes}</p>}
          </Card>

          <Card title="Documents" padded={false} actions={can("documents.manage") ? <UploadDialog counterpartyId={cp.id} defaultKind="other" triggerSize="sm" /> : undefined}>
            {data.documents.length === 0 ? <p className="p-4 text-[13.5px] text-muted">No documents.</p> : (
              <ul className="divide-y divide-line">{data.documents.map((d) => <li key={d.id} className="px-4 py-2.5 text-[13.5px]"><a href={signDocumentUrl(d.id, ctx.userId)} target="_blank" rel="noreferrer" className="text-accent hover:underline">{d.originalName}</a><span className="block text-[12px] text-muted">{d.kind.replace(/_/g, " ")}{d.invoice ? ` · ${d.invoice.invoiceNumber}` : ""}</span></li>)}</ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
