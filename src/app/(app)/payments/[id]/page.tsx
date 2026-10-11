import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenant } from "@/server/context";
import { getPayment } from "@/server/queries/payments";
import { openInvoicesFor } from "@/server/queries/invoices";
import { NotFoundError } from "@/server/errors";
import { signDocumentUrl } from "@/server/storage";
import { Badge, Card, Dl, Notice, PageHeader, Table, Td, Th } from "@/components/ui";
import { DateText, DateTimeText, Money } from "@/components/format";
import { ConfirmAction } from "@/components/forms";
import { AllocateExistingForm } from "@/components/PaymentForm";
import { ReallocateDialog, UploadDialog } from "@/components/collections/Dialogs";
import { reverseAllocationAction, reversePaymentAction } from "@/actions/payments";
import { fromDecimal, formatINR } from "@/domain/money";
import { formatDate } from "@/domain/dates";

export const metadata = { title: "Payment" };

export default async function PaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireTenant();
  const { id } = await params;
  const { p, audit, userName } = await getPayment(ctx, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const recv = p.direction === "received";
  const unallocated = fromDecimal(p.amount) - fromDecimal(p.allocatedAmount);
  const open = p.status === "active" ? await openInvoicesFor(ctx, p.counterpartyId, recv ? "receivable" : "payable") : [];
  const opts = open.map((o) => ({ id: o.id, invoiceNumber: o.invoiceNumber, dueDate: o.dueDate, dueLabel: formatDate(o.dueDate), outstanding: formatINR(o.outstanding, { symbol: false }) }));
  return (
    <>
      <PageHeader
        breadcrumbs={[{ href: "/payments", label: "Payments" }, { label: formatDate(p.paymentDate) }]}
        title={<span className="flex flex-wrap items-center gap-2">{recv ? "Payment received" : "Payment made"} · {formatINR(fromDecimal(p.amount))} {p.status === "reversed" && <Badge>Reversed</Badge>}</span>}
        description={<Link href={`/${recv ? "customers" : "suppliers"}/${p.counterpartyId}`} className="font-medium text-ink hover:underline">{p.counterparty.name}</Link>}
        actions={p.status === "active" && ctx.permissions.has("payments.reverse") ? <ConfirmAction action={reversePaymentAction} hidden={{ id: p.id }} label="Reverse payment" size="md" title="Reverse this payment?" description="Use for bounced cheques or entries made in error. All allocations are reversed and the affected invoice balances go back up. Nothing is deleted." reasonLabel="Reason (e.g. cheque returned unpaid)" /> : undefined}
      />
      {p.status === "reversed" && <div className="mb-4"><Notice tone="neutral" title="Reversed">On <DateTimeText value={p.reversedAt} tz={ctx.timezone} /> by {userName(p.reversedById)}: {p.reversalReason}</Notice></div>}
      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          <Card title="Allocations" padded={false}>
            {p.allocations.length === 0 ? <p className="p-4 text-[13.5px] text-muted">Not allocated to any invoice.</p> : (
              <Table>
                <thead><tr><Th>Invoice</Th><Th align="right">Amount</Th><Th>Status</Th><Th>When / who</Th><Th /></tr></thead>
                <tbody>
                  {p.allocations.map((a) => (
                    <tr key={a.id} className={a.status === "reversed" ? "text-muted" : ""}>
                      <Td><Link href={`/${recv ? "receivables" : "payables"}/${a.invoiceId}`} className="font-medium text-accent hover:underline">{a.invoice.invoiceNumber}</Link><span className="block text-[12px] text-muted">due <DateText value={a.invoice.dueDate} /></span></Td>
                      <Td align="right"><Money value={fromDecimal(a.amount)} className={a.status === "reversed" ? "line-through" : ""} /></Td>
                      <Td>{a.status === "active" ? <Badge tone="ok">Applied</Badge> : <><Badge>Reversed</Badge><span className="block max-w-[220px] text-[12px]">{a.reversalReason}</span></>}</Td>
                      <Td className="text-[12.5px]"><DateTimeText value={a.createdAt} tz={ctx.timezone} /> · {userName(a.createdById)}</Td>
                      <Td>{a.status === "active" && ctx.permissions.has("payments.reverse") && <div className="flex gap-1"><ReallocateDialog allocationId={a.id} targets={opts.filter((o) => o.id !== a.invoiceId).map((o) => ({ id: o.id, invoiceNumber: o.invoiceNumber, outstanding: o.outstanding, dueDate: o.dueLabel }))} /><ConfirmAction action={reverseAllocationAction} hidden={{ id: a.id }} label="Reverse" title="Reverse allocation?" description="The amount becomes unallocated on this payment." reasonLabel="Reason" variant="ghost" /></div>}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
          {p.status === "active" && unallocated > 0n && ctx.permissions.has("payments.record") && (
            <Card title="Allocate the remaining balance">
              {opts.length === 0 ? <p className="text-[13.5px] text-muted">No open {recv ? "invoices" : "bills"} for this account. The balance remains as an unallocated credit.</p> : <AllocateExistingForm paymentId={p.id} open={opts} unallocated={formatINR(unallocated, { symbol: false })} />}
            </Card>
          )}
          <Card title="History" padded={false}>
            <ol className="divide-y divide-line">
              {audit.map((a) => <li key={a.id} className="px-4 py-2.5 text-[13px]"><p>{a.summary}</p><p className="text-[12px] text-muted">{userName(a.actorUserId)} · <DateTimeText value={a.createdAt} tz={ctx.timezone} /></p></li>)}
            </ol>
          </Card>
        </div>
        <div className="space-y-5">
          <Card title="Details">
            <Dl items={[["Amount", <Money key="a" value={fromDecimal(p.amount)} />], ["Unallocated", <Money key="u" value={p.status === "active" ? unallocated : 0n} />], ["Payment date", <DateText key="d" value={p.paymentDate} />], ["Method", p.method], ["Reference", p.reference ?? "—"], ["Recorded by", userName(p.createdById)], ["Recorded at", <DateTimeText key="r" value={p.createdAt} tz={ctx.timezone} />], ["Source", p.importBatchId ? "CSV import" : "Manual entry"]]} />
            {p.notes && <p className="mt-3 rounded-md bg-subtle p-2.5 text-[13px]">{p.notes}</p>}
            <p className="mt-3 text-[12px] text-muted">A recorded payment is the team&apos;s record of a transaction; it is not independently verified with a bank.</p>
          </Card>
          <Card title="Confirmation documents" padded={false} actions={ctx.permissions.has("documents.manage") ? <UploadDialog paymentId={p.id} counterpartyId={p.counterpartyId} defaultKind="payment_confirmation" triggerSize="sm" /> : undefined}>
            {p.documents.length === 0 ? <p className="p-4 text-[13.5px] text-muted">No receipt or confirmation attached.</p> : (
              <ul className="divide-y divide-line">{p.documents.map((d) => <li key={d.id} className="px-4 py-2.5 text-[13.5px]"><a href={signDocumentUrl(d.id, ctx.userId)} target="_blank" rel="noreferrer" className="text-accent hover:underline">{d.originalName}</a></li>)}</ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
