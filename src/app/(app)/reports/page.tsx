import Link from "next/link";
import { requireTenant } from "@/server/context";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Reports" };

const REPORTS = [
  { slug: "receivables-ageing", title: "Receivables ageing", text: "Outstanding customer balances by days past due, with customer totals and invoice detail, for any as-of date.", needs: "receivables.view" },
  { slug: "payables-ageing", title: "Payables ageing", text: "The same ageing analysis for supplier bills.", needs: "payables.view" },
  { slug: "customer-outstanding", title: "Customer outstanding", text: "Open, overdue and current balances per customer; oldest invoice, payment timing, broken promises, disputes.", needs: "receivables.view" },
  { slug: "supplier-obligations", title: "Supplier obligations", text: "What you owe each supplier, what falls due, what is planned and what is disputed.", needs: "payables.view" },
  { slug: "collections", title: "Collections effectiveness", text: "Overdue accounts contacted, time to first contact, promises kept vs broken, amounts recovered — with stated definitions.", needs: "receivables.view" },
  { slug: "productivity", title: "Follow-up productivity", text: "Follow-ups due, completed on time, late, missed and escalated, by employee.", needs: "reports.view" },
  { slug: "cash-flow", title: "Cash-flow outlook", text: "Expected incoming and outgoing amounts over 7, 14 and 30 days. An operational forecast, not a guarantee.", needs: "payables.view" },
] as const;

export default async function ReportsPage() {
  const ctx = await requireTenant("reports.view");
  return (
    <>
      <PageHeader title="Reports" description="Every figure is calculated from recorded invoices, payments, promises and follow-ups. Each report states its definitions and can be printed or exported." />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {REPORTS.filter((r) => ctx.permissions.has(r.needs)).map((r) => (
          <Link key={r.slug} href={`/reports/${r.slug}`} className="rounded-[var(--radius-card)] border border-line bg-surface p-4 hover:border-line-strong hover:bg-[#fcfcfa]">
            <p className="font-semibold text-ink">{r.title}</p>
            <p className="mt-1 text-[13.5px] text-muted">{r.text}</p>
          </Link>
        ))}
      </div>
    </>
  );
}
