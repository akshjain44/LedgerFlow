import Link from "next/link";
import { Download, Plus } from "lucide-react";
import { requireTenant } from "@/server/context";
import { listPayments } from "@/server/queries/payments";
import { loadSettingsFor } from "@/server/services/collections";
import { Badge, Card, EmptyState, LinkButton, PageHeader, Table, Td, Th } from "@/components/ui";
import { DateText, Money } from "@/components/format";
import { FilterChips, Pagination, buildQs } from "@/components/ListControls";
import { fromDecimal } from "@/domain/money";

export const metadata = { title: "Payments" };

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireTenant();
  const sp = await searchParams;
  const params = { direction: sp.direction, q: sp.q, from: sp.from, to: sp.to, status: sp.status, method: sp.method, unallocated: sp.unallocated };
  const [data, { settings }] = await Promise.all([listPayments(ctx, { ...params, page: Number(sp.page) || 1 }), loadSettingsFor(ctx)]);
  const canR = ctx.permissions.has("receivables.view");
  const canP = ctx.permissions.has("payables.view");
  const canRecord = ctx.permissions.has("payments.record");
  return (
    <>
      <PageHeader
        title="Payments"
        description="Actual money received from customers and paid to suppliers, as recorded. Reversed payments stay visible for the audit trail."
        actions={
          <>
            {ctx.permissions.has("exports.run") && <LinkButton href={`/api/export/payments${buildQs(params, {})}`} prefetch={false}><Download className="h-4 w-4" />Export CSV</LinkButton>}
            {canRecord && canR && <LinkButton href="/payments/new?direction=received" variant="primary"><Plus className="h-4 w-4" />Payment received</LinkButton>}
            {canRecord && canP && <LinkButton href="/payments/new?direction=made"><Plus className="h-4 w-4" />Payment made</LinkButton>}
          </>
        }
      />
      <div className="mb-3 flex flex-wrap gap-3">
        <FilterChips path="/payments" params={params} param="direction" current={sp.direction ?? ""} options={[{ key: "", label: "All" }, ...(canR ? [{ key: "received", label: "Received" }] : []), ...(canP ? [{ key: "made", label: "Made" }] : [])]} />
        <FilterChips path="/payments" params={params} param="unallocated" current={sp.unallocated ?? ""} options={[{ key: "", label: "Any allocation" }, { key: "1", label: "Has unallocated balance" }]} />
      </div>
      <form action="/payments" className="no-print mb-4 grid gap-2 rounded-lg border border-line bg-surface p-3 sm:grid-cols-2 lg:grid-cols-6">
        {sp.direction && <input type="hidden" name="direction" value={sp.direction} />}
        <input name="q" defaultValue={sp.q} placeholder="Reference or account" aria-label="Search" className="h-9 rounded-md border border-line-strong px-3 text-[13.5px] lg:col-span-2" />
        <label className="flex items-center gap-1 text-[13px]">From <input type="date" name="from" defaultValue={sp.from} className="h-9 flex-1 rounded-md border border-line-strong px-2" /></label>
        <label className="flex items-center gap-1 text-[13px]">To <input type="date" name="to" defaultValue={sp.to} className="h-9 flex-1 rounded-md border border-line-strong px-2" /></label>
        <select name="method" defaultValue={sp.method ?? ""} aria-label="Method" className="h-9 rounded-md border border-line-strong bg-surface px-2 text-[13.5px]"><option value="">Any method</option>{settings.paymentMethods.map((m) => <option key={m}>{m}</option>)}</select>
        <div className="flex gap-2">
          <select name="status" defaultValue={sp.status ?? ""} aria-label="Status" className="h-9 flex-1 rounded-md border border-line-strong bg-surface px-2 text-[13.5px]"><option value="">Active</option><option value="reversed">Reversed</option><option value="all">All</option></select>
          <button className="h-9 rounded-md bg-ink px-3 text-[13.5px] font-medium text-white">Apply</button>
        </div>
      </form>
      <Card padded={false}>
        {data.total === 0 ? (
          <div className="p-4"><EmptyState title="No payments match" action={canRecord && canR ? <LinkButton href="/payments/new?direction=received" variant="primary">Record a payment</LinkButton> : undefined}>Payments you record appear here with their allocations.</EmptyState></div>
        ) : (
          <>
            <div className="flex flex-wrap gap-4 px-3 py-2 text-[13px] text-muted">
              {canR && <span>Received (active): <Money value={data.totals.received} className="font-semibold text-ok" /></span>}
              {canP && <span>Paid out (active): <Money value={data.totals.made} className="font-semibold text-ink" /></span>}
            </div>
            <Table>
              <thead><tr><Th>Date</Th><Th>Direction</Th><Th>Account</Th><Th>Method / reference</Th><Th align="right">Amount</Th><Th align="right">Unallocated</Th><Th>Allocated to</Th><Th>Status</Th><Th>Recorded by</Th></tr></thead>
              <tbody>
                {data.rows.map((p) => {
                  const un = fromDecimal(p.amount) - fromDecimal(p.allocatedAmount);
                  return (
                    <tr key={p.id} className={p.status === "reversed" ? "text-muted" : "hover:bg-[#fbfbf8]"}>
                      <Td><Link href={`/payments/${p.id}`} className="font-medium text-accent hover:underline"><DateText value={p.paymentDate} /></Link></Td>
                      <Td><Badge tone={p.direction === "received" ? "ok" : "warn"}>{p.direction === "received" ? "Received" : "Paid"}</Badge></Td>
                      <Td><Link href={`/${p.direction === "received" ? "customers" : "suppliers"}/${p.counterparty.id}`} className="hover:underline">{p.counterparty.name}</Link></Td>
                      <Td>{p.method}{p.reference && <span className="block text-[12px] text-muted">{p.reference}</span>}</Td>
                      <Td align="right" className="font-semibold"><Money value={fromDecimal(p.amount)} className={p.status === "reversed" ? "line-through" : ""} /></Td>
                      <Td align="right">{p.status === "active" && un > 0n ? <Money value={un} className="text-warn" /> : <span className="text-muted">—</span>}</Td>
                      <Td className="text-[12.5px]">{p.allocations.map((a) => a.invoice.invoiceNumber).join(", ") || "—"}</Td>
                      <Td>{p.status === "active" ? <Badge tone="ok">Recorded</Badge> : <Badge>Reversed</Badge>}</Td>
                      <Td className="text-[12.5px]">{p.createdByName}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            <Pagination path="/payments" params={params} page={data.page} pageSize={data.pageSize} total={data.total} />
          </>
        )}
      </Card>
    </>
  );
}
