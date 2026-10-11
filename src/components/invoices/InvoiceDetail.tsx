import Link from "next/link";
import { notFound } from "next/navigation";
import { Phone, Printer } from "lucide-react";
import type { InvoiceDirection } from "@prisma/client";
import type { TenantContext } from "@/server/context";
import { getInvoiceDetail, openInvoicesFor } from "@/server/queries/invoices";
import { memberOptions } from "@/server/queries/counterparties";
import { loadSettingsFor } from "@/server/services/collections";
import { NotFoundError } from "@/server/errors";
import { signDocumentUrl } from "@/server/storage";
import { Badge, Card, Dl, EmptyState, LinkButton, Notice, PageHeader, Table, Td, Th } from "@/components/ui";
import { DateText, DateTimeText, DaysLabel, Money, PromiseBadge, StatusBadge, PRIORITY_TONE } from "@/components/format";
import { ConfirmAction } from "@/components/forms";
import {
  AdjustmentDialog, CompleteFollowUpDialog, DisputeDialog, DisputeUpdateDialog, FollowUpDialog, LogCallDialog, MessageDialog,
  PlannedPaymentDialog, PromiseDialog, ReallocateDialog, RescheduleDialog, ReviewPromiseDialog, UploadDialog, type InvoiceOption,
} from "@/components/collections/Dialogs";
import { voidInvoiceAction, issueDraftAction, reverseAdjustmentAction } from "@/actions/invoices";
import { reverseAllocationAction } from "@/actions/payments";
import { cancelPromiseAction, cancelFollowUpAction, cancelPlannedPaymentAction } from "@/actions/collections";
import { deleteDocumentAction } from "@/actions/misc";
import { fromDecimal, formatINR } from "@/domain/money";
import { fromDbDate, formatDate } from "@/domain/dates";
import { REMINDER_LABELS, type ReminderType } from "@/domain/reminderSchedule";
import { OUTCOME_LABELS } from "@/lib/display";

const DISPUTE_LABEL: Record<string, string> = { quantity_mismatch: "Quantity mismatch", rate_mismatch: "Rate mismatch", missing_delivery_docs: "Missing delivery docs", damaged_goods: "Damaged goods", invoice_discrepancy: "Invoice discrepancy", tax_discrepancy: "Tax / GST discrepancy", allocation_discrepancy: "Allocation discrepancy", other: "Other" };
const DOC_LABEL: Record<string, string> = { invoice: "Invoice", supplier_bill: "Supplier bill", purchase_order: "Purchase order", delivery_challan: "Delivery challan", payment_confirmation: "Payment confirmation", dispute_evidence: "Dispute evidence", other: "Other" };

export async function InvoiceDetail({ ctx, id, direction }: { ctx: TenantContext; id: string; direction: InvoiceDirection }) {
  const detail = await getInvoiceDetail(ctx, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const { inv, facts, status, daysPastDue, audit, userName } = detail;
  if (inv.direction !== direction) notFound();
  const recv = direction === "receivable";
  const base = recv ? "/receivables" : "/payables";
  const [members, open, { settings }] = await Promise.all([memberOptions(ctx), openInvoicesFor(ctx, inv.counterpartyId, direction), loadSettingsFor(ctx)]);
  const opts: InvoiceOption[] = open.map((o) => ({ id: o.id, invoiceNumber: o.invoiceNumber, outstanding: formatINR(o.outstanding, { symbol: false }), dueDate: formatDate(o.dueDate) }));
  const outstanding = fromDecimal(inv.outstandingAmount);
  const can = (p: Parameters<typeof ctx.permissions.has>[0]) => ctx.permissions.has(p);
  const canManage = can(recv ? "receivables.manage" : "payables.manage");
  const isOpen = inv.lifecycle === "open";
  const openDisputes = inv.disputes.filter((d) => d.status !== "resolved" && d.status !== "closed");
  const promises = inv.promiseLinks.map((l) => l.promise).sort((a, b) => +b.promisedDate - +a.promisedDate);
  const cp = inv.counterparty;
  const partyPath = recv ? `/customers/${cp.id}` : `/suppliers/${cp.id}`;

  // Unified timeline: communications + follow-ups + messages.
  const timeline = [
    ...inv.communications.map((c) => ({ at: c.communication.contactedAt, kind: "contact" as const, c: c.communication })),
    ...inv.messages.map((m) => ({ at: m.createdAt, kind: "message" as const, m })),
  ].sort((a, b) => +b.at - +a.at);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ href: base, label: recv ? "Receivables" : "Payables" }, { href: partyPath, label: cp.name }, { label: inv.invoiceNumber }]}
        title={<span className="flex flex-wrap items-center gap-2">{recv ? "Invoice" : "Bill"} {inv.invoiceNumber} <StatusBadge status={status} partiallyPaid={fromDecimal(inv.amountPaid) > 0n} />{openDisputes.length > 0 && <Badge tone="warn">Disputed{openDisputes.some((d) => d.collectionHold) ? " · on hold" : ""}</Badge>}{!recv && <Badge tone={PRIORITY_TONE[inv.priority]}>{inv.priority} priority</Badge>}</span>}
        description={<><Link href={partyPath} className="font-medium text-ink hover:underline">{cp.name}</Link>{cp.phone && <> · <a href={`tel:${cp.phone.replace(/\s/g, "")}`} className="inline-flex items-center gap-1 text-accent hover:underline"><Phone className="h-3.5 w-3.5" />{cp.phone}</a></>}{cp.contactPerson && <> · {cp.contactPerson}</>}</>}
        actions={
          <>
            {inv.lifecycle === "draft" && canManage && <ConfirmAction action={issueDraftAction} hidden={{ id: inv.id }} label="Issue invoice" title="Issue this invoice?" description="It becomes open: it counts in balances and its reminder schedule starts." variant="primary" size="md" confirmLabel="Issue" />}
            {isOpen && outstanding > 0n && can("payments.record") && <LinkButton variant="primary" href={`/payments/new?direction=${recv ? "received" : "made"}&counterpartyId=${cp.id}&invoiceId=${inv.id}&returnTo=${base}/${inv.id}`}>Record payment</LinkButton>}
            {isOpen && can("collections.work") && <LogCallDialog counterpartyId={cp.id} invoices={opts} defaultInvoiceIds={[inv.id]} today={ctx.today} isCustomer={recv} contactPerson={cp.contactPerson} triggerLabel={recv ? "Record call" : "Record communication"} triggerVariant="secondary" />}
            {recv && isOpen && outstanding > 0n && can("collections.work") && <PromiseDialog counterpartyId={cp.id} invoices={opts} defaultInvoiceIds={[inv.id]} today={ctx.today} />}
            {!recv && isOpen && outstanding > 0n && can("payables.manage") && <PlannedPaymentDialog invoiceId={inv.id} outstanding={formatINR(outstanding, { symbol: false })} today={ctx.today} />}
            {canManage && inv.lifecycle !== "void" && <LinkButton href={`${base}/${inv.id}/edit`}>Edit</LinkButton>}
          </>
        }
      />
      {ctx.isDemo && <div className="mb-4"><Notice tone="warn">Demo data — fictional.</Notice></div>}
      {inv.lifecycle === "void" && <div className="mb-4"><Notice tone="neutral" title="Void">Voided on <DateTimeText value={inv.voidedAt} tz={ctx.timezone} />: {inv.voidReason}. Excluded from balances and reminders.</Notice></div>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Summary label={recv ? "Invoice total" : "Bill total"} value={<Money value={facts.total} />} />
        <Summary label="Paid" value={<Money value={facts.paid} />} sub={`${inv.allocations.filter((a) => a.status === "active").length} payment allocations`} />
        <Summary label="Credits / write-offs" value={<Money value={facts.adjusted} />} />
        <Summary label="Outstanding" value={<Money value={outstanding} className={outstanding > 0n && status === "overdue" ? "text-bad" : ""} />} strong />
        <Summary label="Due date" value={<DateText value={facts.dueDate} />} sub={status === "paid" ? (inv.settledOn ? `Settled ${formatDate(inv.settledOn)}${fromDbDate(inv.settledOn) > facts.dueDate ? " (after due date)" : ""}` : "Settled") : <DaysLabel days={isOpen ? daysPastDue : null} />} />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_380px]">
        <div className="space-y-5">
          <Card title="Payment history" padded={false} actions={isOpen && can("payments.reverse") ? <AdjustmentDialog invoiceId={inv.id} today={ctx.today} /> : undefined}>
            {inv.allocations.length === 0 && inv.adjustments.length === 0 ? (
              <p className="p-4 text-[13.5px] text-muted">No payments recorded against this {recv ? "invoice" : "bill"} yet.</p>
            ) : (
              <Table>
                <thead><tr><Th>Date</Th><Th>Type</Th><Th>Method / reference</Th><Th align="right">Amount</Th><Th>Status</Th><Th>Recorded by</Th><Th /></tr></thead>
                <tbody>
                  {inv.allocations.map((a) => (
                    <tr key={a.id} className={a.status === "reversed" ? "text-muted" : ""}>
                      <Td><DateText value={a.payment.paymentDate} /></Td>
                      <Td><Link href={`/payments/${a.paymentId}`} className="hover:underline">{recv ? "Payment received" : "Payment made"}</Link></Td>
                      <Td>{a.payment.method}{a.payment.reference && <span className="block text-[12px] text-muted">Ref {a.payment.reference}</span>}</Td>
                      <Td align="right"><Money value={fromDecimal(a.amount)} className={a.status === "reversed" ? "line-through" : ""} /></Td>
                      <Td>{a.status === "active" ? <Badge tone="ok">Applied</Badge> : <Badge tone="neutral" title={a.reversalReason ?? ""}>Reversed</Badge>}{a.reversalReason && <span className="block max-w-[200px] text-[12px] text-muted">{a.reversalReason}</span>}</Td>
                      <Td className="text-[12.5px]">{userName(a.createdById)}<span className="block text-muted"><DateTimeText value={a.createdAt} tz={ctx.timezone} /></span></Td>
                      <Td>
                        {a.status === "active" && can("payments.reverse") && (
                          <div className="flex flex-wrap gap-1">
                            <ReallocateDialog allocationId={a.id} targets={opts.filter((o) => o.id !== inv.id)} />
                            <ConfirmAction action={reverseAllocationAction} hidden={{ id: a.id }} label="Reverse" title="Reverse this allocation?" description="The payment stays recorded; this amount becomes unallocated and the invoice balance increases. The reversal is kept in the history." reasonLabel="Reason" variant="ghost" />
                          </div>
                        )}
                      </Td>
                    </tr>
                  ))}
                  {inv.adjustments.map((a) => (
                    <tr key={a.id} className={a.status === "reversed" ? "text-muted" : ""}>
                      <Td><DateText value={a.adjustmentDate} /></Td>
                      <Td>{a.kind === "credit_note" ? "Credit note" : "Write-off"}</Td>
                      <Td>{a.reference ?? "—"}<span className="block text-[12px] text-muted">{a.reason}</span></Td>
                      <Td align="right"><Money value={fromDecimal(a.amount)} className={a.status === "reversed" ? "line-through" : ""} /></Td>
                      <Td>{a.status === "active" ? <Badge tone="accent">Applied</Badge> : <Badge>Reversed</Badge>}</Td>
                      <Td className="text-[12.5px]">{userName(a.createdById)}</Td>
                      <Td>{a.status === "active" && can("payments.reverse") && <ConfirmAction action={reverseAdjustmentAction} hidden={{ id: a.id }} label="Reverse" title="Reverse adjustment?" description="The outstanding balance increases by this amount." reasonLabel="Reason" variant="ghost" />}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          {!recv && (
            <Card title="Planned payments" description="Plans only — not counted as paid until a payment is recorded." padded={false}>
              {inv.plannedPayments.length === 0 ? <p className="p-4 text-[13.5px] text-muted">No payment planned.</p> : (
                <Table>
                  <thead><tr><Th>Planned date</Th><Th align="right">Amount</Th><Th>Status</Th><Th>Notes</Th><Th /></tr></thead>
                  <tbody>
                    {inv.plannedPayments.map((p) => (
                      <tr key={p.id}>
                        <Td><DateText value={p.plannedDate} />{p.rescheduleCount > 0 && <span className="block text-[12px] text-muted">rescheduled {p.rescheduleCount}×</span>}</Td>
                        <Td align="right"><Money value={fromDecimal(p.amount)} /></Td>
                        <Td><Badge tone={p.status === "scheduled" ? "accent" : p.status === "completed" ? "ok" : "neutral"}>{p.status}</Badge>{p.promisedToSupplier && <span className="block text-[12px] text-warn">Promised to supplier</span>}</Td>
                        <Td className="max-w-[260px] whitespace-pre-line text-[12.5px]">{p.notes ?? "—"}</Td>
                        <Td>{p.status === "scheduled" && can("payables.manage") && <div className="flex gap-1"><RescheduleDialog id={p.id} kind="planned" today={ctx.today} /><ConfirmAction action={cancelPlannedPaymentAction} hidden={{ id: p.id }} label="Cancel" title="Cancel planned payment?" description="Only the plan is cancelled." reasonLabel="Reason" variant="ghost" /></div>}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
          )}

          {recv && (
            <Card title="Promises to pay" padded={false} actions={isOpen && outstanding > 0n && can("collections.work") ? <PromiseDialog counterpartyId={cp.id} invoices={opts} defaultInvoiceIds={[inv.id]} today={ctx.today} triggerSize="sm" /> : undefined}>
              {promises.length === 0 ? <p className="p-4 text-[13.5px] text-muted">No promises recorded.</p> : (
                <Table>
                  <thead><tr><Th>Promised date</Th><Th align="right">Promised</Th><Th align="right">Received by date</Th><Th>Outcome</Th><Th>Reason / notes</Th><Th /></tr></thead>
                  <tbody>
                    {promises.map((p) => (
                      <tr key={p.id}>
                        <Td><DateText value={p.promisedDate} /><span className="block text-[12px] text-muted">logged <DateTimeText value={p.recordedAt} tz={ctx.timezone} /></span></Td>
                        <Td align="right"><Money value={fromDecimal(p.amount)} />{p.isFullPayment && <span className="block text-[12px] text-muted">full payment</span>}</Td>
                        <Td align="right">{p.status === "upcoming" ? <span className="text-muted">—</span> : <Money value={fromDecimal(p.amountReceived)} />}</Td>
                        <Td><PromiseBadge status={p.status} date={fromDbDate(p.promisedDate)} today={ctx.today} />{p.needsReview && <span className="mt-0.5 block"><Badge tone="warn">Needs review</Badge></span>}</Td>
                        <Td className="max-w-[240px] text-[12.5px]">{p.reason ?? "—"}{p.cancelReason && <span className="block text-muted">Cancelled: {p.cancelReason}</span>}{p.reviewNote && <span className="block text-muted">Review: {p.reviewNote}</span>}</Td>
                        <Td>
                          {can("collections.work") && p.status === "upcoming" && <ConfirmAction action={cancelPromiseAction} hidden={{ id: p.id }} label="Cancel" title="Cancel promise?" description="Use when the customer withdrew or replaced the commitment." reasonLabel="Reason" variant="ghost" />}
                          {can("collections.work") && p.needsReview && <ReviewPromiseDialog id={p.id} partial={p.status === "partially_kept"} today={ctx.today} />}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
          )}

          <Card title="Disputes" padded={false} actions={inv.lifecycle !== "void" && can("collections.work") ? <DisputeDialog invoiceId={inv.id} members={members} policyHold={settings.disputePolicy === "hold"} triggerSize="sm" /> : undefined}>
            {inv.disputes.length === 0 ? <p className="p-4 text-[13.5px] text-muted">No disputes.</p> : (
              <ul className="divide-y divide-line">
                {inv.disputes.map((d) => (
                  <li key={d.id} className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">{DISPUTE_LABEL[d.category]} {d.disputedAmount && <span className="text-muted">· <Money value={fromDecimal(d.disputedAmount)} /> disputed</span>}</p>
                        <p className="text-[12.5px] text-muted">Raised <DateText value={d.raisedOn} /> · {userName(d.assignedUserId)}{d.collectionHold && <> · <span className="text-warn">collections on hold: {d.holdReason}</span></>}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge tone={d.status === "resolved" || d.status === "closed" ? "ok" : "warn"}>{d.status.replace(/_/g, " ")}</Badge>
                        {can("collections.work") && <DisputeUpdateDialog disputeId={d.id} status={d.status} hold={d.collectionHold} />}
                        {can("documents.manage") && <UploadDialog invoiceId={inv.id} disputeId={d.id} defaultKind="dispute_evidence" triggerSize="sm" />}
                      </div>
                    </div>
                    <p className="mt-2 whitespace-pre-line text-[13.5px]">{d.description}</p>
                    {d.resolutionNotes && <p className="mt-1 text-[13px] text-ok">Resolution: {d.resolutionNotes} ({formatDate(d.resolvedOn)})</p>}
                    {d.updates.length > 1 && (
                      <ol className="mt-2 space-y-1 border-l border-line pl-3 text-[12.5px] text-muted">
                        {d.updates.map((u) => <li key={u.id}><DateTimeText value={u.createdAt} tz={ctx.timezone} />: {u.fromStatus ? `${u.fromStatus.replace(/_/g, " ")} → ` : ""}{u.toStatus.replace(/_/g, " ")}{u.note ? ` — ${u.note}` : ""}</li>)}
                      </ol>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Follow-up timeline" padded={false} actions={can("collections.work") ? <><FollowUpDialog counterpartyId={cp.id} invoiceId={inv.id} members={members} today={ctx.today} defaultTitle={`${recv ? "Call" : "Contact"} ${cp.name} about ${inv.invoiceNumber}`} triggerSize="sm" /><MessageDialog counterpartyId={cp.id} invoiceId={inv.id} supplier={!recv} triggerSize="sm" /></> : undefined}>
            {inv.followUps.filter((f) => f.status === "pending").length > 0 && (
              <div className="border-b border-line bg-[#fafaf7] p-3">
                <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted">Scheduled</p>
                <ul className="space-y-2">
                  {inv.followUps.filter((f) => f.status === "pending").map((f) => (
                    <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 text-[13.5px]">
                      <span><DateText value={f.dueDate} className={fromDbDate(f.dueDate) < ctx.today ? "font-semibold text-bad" : "font-medium"} /> · {f.title} <span className="text-muted">({userName(f.assignedUserId)})</span></span>
                      {can("collections.work") && <span className="flex gap-1"><LogCallDialog counterpartyId={cp.id} invoices={opts} defaultInvoiceIds={[inv.id]} followUpId={f.id} today={ctx.today} isCustomer={recv} triggerLabel="Record call" triggerVariant="subtle" triggerSize="sm" /><CompleteFollowUpDialog id={f.id} /><RescheduleDialog id={f.id} kind="followup" today={ctx.today} /><ConfirmAction action={cancelFollowUpAction} hidden={{ id: f.id }} label="Cancel" title="Cancel follow-up?" description="It will be kept in history as cancelled." reasonLabel="Reason" variant="ghost" /></span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {timeline.length === 0 && inv.followUps.filter((f) => f.status !== "pending").length === 0 ? (
              <p className="p-4 text-[13.5px] text-muted">No contact recorded for this {recv ? "invoice" : "bill"} yet.</p>
            ) : (
              <ol className="divide-y divide-line">
                {timeline.map((t, i) =>
                  t.kind === "contact" ? (
                    <li key={i} className="px-4 py-3 text-[13.5px]">
                      <p><span className="font-medium capitalize">{t.c.channel}</span>{t.c.outcome && <> · <Badge tone="info">{OUTCOME_LABELS[t.c.outcome]}</Badge></>} <span className="text-muted">{t.c.direction === "inbound" ? "(inbound)" : ""}{t.c.contactPerson ? ` with ${t.c.contactPerson}` : ""}</span></p>
                      {t.c.notes && <p className="mt-1 whitespace-pre-line text-ink-2">{t.c.notes}</p>}
                      <p className="mt-1 text-[12px] text-muted">{userName(t.c.createdById)} · <DateTimeText value={t.c.contactedAt} tz={ctx.timezone} /></p>
                    </li>
                  ) : (
                    <li key={i} className="px-4 py-3 text-[13.5px]">
                      <p><span className="font-medium">Message {t.m.status}</span> · {t.m.subject}</p>
                      <p className="mt-1 text-[12px] text-muted">{t.m.channel === "email" ? `to ${t.m.recipient}` : "copied for manual sending"} · {userName(t.m.createdById)} · <DateTimeText value={t.m.createdAt} tz={ctx.timezone} />{t.m.error && <span className="text-bad"> · {t.m.error}</span>}</p>
                    </li>
                  ),
                )}
                {inv.followUps.filter((f) => f.status !== "pending").map((f) => (
                  <li key={f.id} className="px-4 py-3 text-[13px] text-muted">Follow-up “{f.title}” {f.status} {f.completedAt && <DateTimeText value={f.completedAt} tz={ctx.timezone} />}{f.completionNote ? ` — ${f.completionNote}` : ""}</li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="Details">
            <Dl
              cols={2}
              items={[
                [recv ? "Invoice date" : "Bill date", <DateText key="d" value={inv.invoiceDate} />],
                ["Due date", <span key="due"><DateText value={inv.dueDate} /> <span className="text-[12px] text-muted">({inv.dueDateManual ? "entered" : `${inv.creditDays ?? "?"} days credit`})</span></span>],
                ["Payment terms", inv.paymentTerms ?? "—"],
                ["Amount before tax", inv.subtotalAmount ? <Money value={fromDecimal(inv.subtotalAmount)} /> : "—"],
                ["Tax", inv.taxAmount ? <Money value={fromDecimal(inv.taxAmount)} /> : "—"],
                ["PO reference", inv.poReference ?? "—"],
                [recv ? "Delivery challan / POD" : "Goods receipt", inv.deliveryReference ?? "—"],
                ["Responsible", userName(inv.assignedUserId) === "System" ? "Unassigned" : userName(inv.assignedUserId)],
                ["Reminders", inv.remindersEnabled ? "On" : "Off"],
                ["Created", <DateTimeText key="c" value={inv.createdAt} tz={ctx.timezone} />],
              ]}
            />
            {inv.notes && <p className="mt-3 whitespace-pre-line rounded-md bg-subtle p-2.5 text-[13px]">{inv.notes}</p>}
            {inv.duplicateOverride && <p className="mt-2 text-[12.5px] text-warn">Duplicate number allowed: {inv.duplicateOverride}</p>}
            <div className="mt-4 flex flex-wrap gap-2">
              <LinkButton size="sm" href={`${partyPath}/statement`}><Printer className="h-3.5 w-3.5" />Statement</LinkButton>
              {inv.lifecycle !== "void" && can("invoices.void") && <ConfirmAction action={voidInvoiceAction} hidden={{ id: inv.id }} label="Void" title={`Void ${inv.invoiceNumber}?`} description="A void invoice is excluded from balances and reminders. It stays on record. Payments must be reversed or reallocated first." reasonLabel="Reason for voiding" />}
            </div>
          </Card>

          <Card title="Documents" padded={false} actions={can("documents.manage") && inv.lifecycle !== "void" ? <UploadDialog invoiceId={inv.id} defaultKind={recv ? "invoice" : "supplier_bill"} triggerSize="sm" /> : undefined}>
            {inv.documents.length === 0 ? (
              <p className="p-4 text-[13.5px] text-muted">No documents. Upload the invoice, PO and delivery challan so the evidence is at hand during calls.</p>
            ) : (
              <ul className="divide-y divide-line">
                {inv.documents.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-[13.5px]">
                    <div className="min-w-0">
                      <a href={signDocumentUrl(d.id, ctx.userId)} target="_blank" rel="noreferrer" className="block truncate font-medium text-accent hover:underline">{d.originalName}</a>
                      <p className="text-[12px] text-muted">{DOC_LABEL[d.kind]} · {(d.sizeBytes / 1024).toFixed(0)} KB · {userName(d.uploadedById)} · <DateText value={d.createdAt} /></p>
                    </div>
                    {can("documents.manage") && <ConfirmAction action={deleteDocumentAction} hidden={{ id: d.id }} label="Remove" title="Remove document?" description="The file is hidden from the record; the upload and removal stay in the audit log." reasonLabel="Reason" variant="ghost" />}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Reminder schedule" description="Internal reminders to the responsible employee" padded={false}>
            {inv.reminderJobs.length === 0 ? (
              <p className="p-4 text-[13.5px] text-muted">{inv.remindersEnabled ? "No reminders scheduled." : "Reminders are off for this invoice."}</p>
            ) : (
              <ul className="divide-y divide-line">
                {inv.reminderJobs.map((j) => (
                  <li key={j.id} className="px-4 py-2 text-[13px]">
                    <div className="flex items-center justify-between gap-2">
                      <span><DateText value={j.scheduledFor} /> · {REMINDER_LABELS[j.type as ReminderType] ?? j.type}</span>
                      <Badge tone={j.status === "completed" ? "ok" : j.status === "failed" ? "bad" : j.status === "pending" ? "accent" : "neutral"}>{j.status}</Badge>
                    </div>
                    {j.statusReason && <p className="text-[12px] text-muted">{j.statusReason}</p>}
                    {j.deliveries.map((d) => (
                      <p key={d.id} className="text-[12px] text-muted">→ {d.channel === "in_app" ? "In-app" : "Email"} to {userName(d.recipientUserId)}: {d.status}{d.statusReason ? ` (${d.statusReason})` : ""}{d.lastError && d.status === "failed" ? ` — ${d.lastError}` : ""}</p>
                    ))}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Audit history" padded={false}>
            {audit.length === 0 ? <p className="p-4 text-[13.5px] text-muted">No events.</p> : (
              <ol className="max-h-[420px] divide-y divide-line overflow-y-auto">
                {audit.map((a) => (
                  <li key={a.id} className="px-4 py-2.5 text-[13px]">
                    <p>{a.summary ?? a.action}</p>
                    <p className="text-[12px] text-muted">{userName(a.actorUserId)} · <DateTimeText value={a.createdAt} tz={ctx.timezone} /></p>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>
      {!isOpen && inv.lifecycle === "draft" && <div className="mt-4"><EmptyState title="Draft">Drafts are excluded from balances, reports and reminders until issued.</EmptyState></div>}
    </>
  );
}

function Summary({ label, value, sub, strong }: { label: string; value: React.ReactNode; sub?: React.ReactNode; strong?: boolean }) {
  return (
    <div className={`rounded-[var(--radius-card)] border bg-surface p-3.5 ${strong ? "border-ink/30" : "border-line"}`}>
      <p className="text-[12.5px] font-medium text-muted">{label}</p>
      <p className={`num mt-1 ${strong ? "text-[22px]" : "text-[18px]"} font-semibold`}>{value}</p>
      {sub && <p className="mt-0.5 text-[12.5px] text-muted">{sub}</p>}
    </div>
  );
}
