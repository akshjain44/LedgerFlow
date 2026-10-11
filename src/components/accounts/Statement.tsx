import { notFound } from "next/navigation";
import type { TenantContext } from "@/server/context";
import { statement } from "@/server/queries/reports";
import { loadSettingsFor } from "@/server/services/collections";
import { Money, DateText } from "@/components/format";
import { PrintButton } from "@/components/PrintButton";
import { formatDate } from "@/domain/dates";

export async function Statement({ ctx, id, kind, from, to }: { ctx: TenantContext; id: string; kind: "customer" | "supplier"; from?: string; to?: string }) {
  const s = await statement(ctx, id, kind === "customer" ? "receivable" : "payable", from, to).catch(() => notFound());
  if ((kind === "customer" && !s.cp.isCustomer) || (kind === "supplier" && !s.cp.isSupplier)) notFound();
  const { business } = await loadSettingsFor(ctx);
  return (
    <div className="mx-auto max-w-4xl">
      <div className="no-print mb-4 flex flex-wrap items-end justify-between gap-2">
        <form className="flex flex-wrap items-end gap-2 text-[13px]">
          <label>From<input type="date" name="from" defaultValue={s.from ?? ""} className="ml-1 h-8 rounded-md border border-line-strong px-2" /></label>
          <label>To<input type="date" name="to" defaultValue={s.to} className="ml-1 h-8 rounded-md border border-line-strong px-2" /></label>
          <button className="h-8 rounded-md border border-line-strong bg-surface px-3 font-medium">Apply</button>
        </form>
        <PrintButton />
      </div>
      <div className="print-plain rounded-xl border border-line bg-surface p-6 sm:p-8">
        <div className="flex flex-wrap justify-between gap-4 border-b border-line pb-4">
          <div>
            <p className="text-lg font-semibold">{business.legalName ?? business.name}</p>
            {business.address && <p className="whitespace-pre-line text-[13px] text-muted">{business.address}</p>}
            {business.gstin && <p className="text-[13px] text-muted">GSTIN {business.gstin}</p>}
          </div>
          <div className="text-right">
            <p className="text-[13px] font-semibold uppercase tracking-wider text-muted">Statement of account</p>
            <p className="text-[13px]">{s.from ? `${formatDate(s.from)} – ` : "Up to "}{formatDate(s.to)}</p>
            <p className="text-[12px] text-muted">Generated {formatDate(ctx.today)}</p>
          </div>
        </div>
        <div className="mt-4">
          <p className="text-[12px] uppercase tracking-wide text-muted">{kind === "customer" ? "Customer" : "Supplier"}</p>
          <p className="font-semibold">{s.cp.name}</p>
          {s.cp.billingAddress && <p className="whitespace-pre-line text-[13px] text-muted">{s.cp.billingAddress}</p>}
          {s.cp.gstin && <p className="text-[13px] text-muted">GSTIN {s.cp.gstin}</p>}
        </div>
        <table className="mt-5 w-full text-[13px]">
          <thead><tr className="border-b border-line text-left text-[12px] uppercase tracking-wide text-muted"><th className="py-2">Date</th><th className="py-2">Type</th><th className="py-2">Reference</th><th className="py-2 text-right">{kind === "customer" ? "Debit" : "Billed"}</th><th className="py-2 text-right">{kind === "customer" ? "Credit" : "Paid"}</th><th className="py-2 text-right">Balance</th></tr></thead>
          <tbody>
            {s.from && <tr className="border-b border-line"><td className="py-1.5" colSpan={5}>Opening balance</td><td className="py-1.5 text-right"><Money value={s.opening} /></td></tr>}
            {s.rows.map((r, i) => (
              <tr key={i} className="border-b border-line">
                <td className="py-1.5"><DateText value={r.date} /></td>
                <td className="py-1.5">{r.kind}</td>
                <td className="py-1.5">{r.ref}</td>
                <td className="py-1.5 text-right">{r.debit > 0n ? <Money value={r.debit} /> : ""}</td>
                <td className="py-1.5 text-right">{r.credit > 0n ? <Money value={r.credit} /> : ""}</td>
                <td className="py-1.5 text-right"><Money value={r.balance} /></td>
              </tr>
            ))}
            {s.rows.length === 0 && <tr><td colSpan={6} className="py-4 text-center text-muted">No transactions in this period.</td></tr>}
          </tbody>
        </table>
        <div className="mt-5 grid gap-2 text-[13.5px] sm:ml-auto sm:w-80">
          <p className="flex justify-between"><span>Closing balance</span><strong><Money value={s.closing} /></strong></p>
          <p className="flex justify-between"><span>Of which overdue (as of {formatDate(ctx.today)})</span><span><Money value={s.overdue} /></span></p>
          {s.unallocatedTotal > 0n && <p className="flex justify-between text-muted"><span>Unallocated payments on account</span><span><Money value={s.unallocatedTotal} /></span></p>}
        </div>
        <p className="mt-6 text-[11.5px] text-muted">Prepared from the business&apos;s own records. Please notify us of any discrepancy.</p>
      </div>
    </div>
  );
}
