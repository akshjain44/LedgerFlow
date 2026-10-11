import Link from "next/link";
import { requireTenant } from "@/server/context";
import { globalSearch } from "@/server/queries/payments";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { DateText, Money } from "@/components/format";
import { fromDecimal } from "@/domain/money";

export const metadata = { title: "Search" };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await requireTenant();
  const { q = "" } = await searchParams;
  const r = await globalSearch(ctx, q);
  const none = r.counterparties.length + r.invoices.length + r.payments.length === 0;
  return (
    <>
      <PageHeader title="Search" />
      <form className="mb-5 flex max-w-xl gap-2" role="search">
        <label htmlFor="q" className="sr-only">Search</label>
        <input id="q" name="q" defaultValue={q} autoFocus placeholder="Account name, invoice no., PO, challan, payment reference, GSTIN, phone" className="h-10 flex-1 rounded-md border border-line-strong px-3" />
        <button className="h-10 rounded-md bg-ink px-4 text-sm font-medium text-white">Search</button>
      </form>
      {q.trim().length < 2 ? <p className="text-[13.5px] text-muted">Type at least two characters.</p> : none ? <EmptyState title={`Nothing found for “${q}”`} /> : (
        <div className="grid gap-5 lg:grid-cols-3">
          <Card title="Accounts" padded={false}>
            <ul className="divide-y divide-line">{r.counterparties.map((c) => <li key={c.id} className="px-4 py-2.5 text-[13.5px]"><Link href={`/${c.isCustomer && ctx.permissions.has("receivables.view") ? "customers" : "suppliers"}/${c.id}`} className="font-medium text-accent hover:underline">{c.name}</Link><span className="block text-[12px] text-muted">{[c.isCustomer && "Customer", c.isSupplier && "Supplier", c.accountCode, c.phone].filter(Boolean).join(" · ")}</span></li>)}</ul>
            {r.counterparties.length === 0 && <p className="p-4 text-[13px] text-muted">None</p>}
          </Card>
          <Card title="Invoices & bills" padded={false}>
            <ul className="divide-y divide-line">{r.invoices.map((i) => <li key={i.id} className="px-4 py-2.5 text-[13.5px]"><Link href={`/${i.direction === "receivable" ? "receivables" : "payables"}/${i.id}`} className="font-medium text-accent hover:underline">{i.invoiceNumber}</Link> <span className="text-muted">· {i.counterparty.name}</span><span className="block text-[12px] text-muted">Due <DateText value={i.dueDate} /> · <Money value={fromDecimal(i.outstandingAmount)} /> outstanding</span></li>)}</ul>
            {r.invoices.length === 0 && <p className="p-4 text-[13px] text-muted">None</p>}
          </Card>
          <Card title="Payments" padded={false}>
            <ul className="divide-y divide-line">{r.payments.map((p) => <li key={p.id} className="px-4 py-2.5 text-[13.5px]"><Link href={`/payments/${p.id}`} className="font-medium text-accent hover:underline">{p.reference}</Link> <span className="text-muted">· {p.counterparty.name}</span><span className="block text-[12px] text-muted"><DateText value={p.paymentDate} /> · <Money value={fromDecimal(p.amount)} /></span></li>)}</ul>
            {r.payments.length === 0 && <p className="p-4 text-[13px] text-muted">None</p>}
          </Card>
        </div>
      )}
    </>
  );
}
