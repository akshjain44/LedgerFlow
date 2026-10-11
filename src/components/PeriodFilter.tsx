import Link from "next/link";
import { PERIOD_OPTIONS, type Period } from "@/server/queries/reports";
import { cn } from "@/lib/cn";

/** Period chips + custom range, all via GET params so links are shareable. */
export function PeriodFilter({ period, basePath, extra = {} }: { period: Period; basePath: string; extra?: Record<string, string | undefined> }) {
  const qs = (o: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...extra, ...o })) if (v) p.set(k, v);
    return `${basePath}?${p.toString()}`;
  };
  return (
    <div className="no-print flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap gap-1 rounded-lg border border-line bg-surface p-1">
        {PERIOD_OPTIONS.filter((o) => o.key !== "custom").map((o) => (
          <Link key={o.key} href={qs({ period: o.key })} className={cn("rounded-md px-2.5 py-1 text-[13px] font-medium", period.key === o.key ? "bg-ink text-white" : "text-ink-2 hover:bg-subtle")}>
            {o.label}
          </Link>
        ))}
      </div>
      <form action={basePath} className="flex flex-wrap items-center gap-1 text-[13px]">
        {Object.entries(extra).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
        <input type="hidden" name="period" value="custom" />
        <label className="sr-only" htmlFor="pf-from">From</label>
        <input id="pf-from" type="date" name="from" defaultValue={period.key === "custom" ? period.from : undefined} className="h-8 rounded-md border border-line-strong bg-surface px-2" />
        <span className="text-muted">to</span>
        <label className="sr-only" htmlFor="pf-to">To</label>
        <input id="pf-to" type="date" name="to" defaultValue={period.key === "custom" ? period.to : undefined} className="h-8 rounded-md border border-line-strong bg-surface px-2" />
        <button className="h-8 rounded-md border border-line-strong bg-surface px-2.5 font-medium hover:bg-subtle">Apply</button>
      </form>
    </div>
  );
}
