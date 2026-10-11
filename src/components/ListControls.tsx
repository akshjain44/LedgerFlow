import Link from "next/link";
import { cn } from "@/lib/cn";

export function buildQs(base: Record<string, string | undefined>, patch: Record<string, string | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...base, ...patch })) if (v !== undefined && v !== "") p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function FilterChips({ path, params, options, param = "filter", current }: { path: string; params: Record<string, string | undefined>; options: readonly { key: string; label: string }[]; param?: string; current?: string }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filters">
      {options.map((o) => {
        const active = (current ?? "") === o.key || (!current && o.key === "");
        return (
          <Link key={o.key} role="tab" aria-selected={active} href={`${path}${buildQs(params, { [param]: o.key || undefined, page: undefined })}`} className={cn("rounded-full border px-3 py-1 text-[13px] font-medium", active ? "border-ink bg-ink text-white" : "border-line-strong bg-surface text-ink-2 hover:bg-subtle")}>
            {o.label}
          </Link>
        );
      })}
    </div>
  );
}

export function SortHeader({ path, params, field, label, align }: { path: string; params: Record<string, string | undefined>; field: string; label: string; align?: "right" }) {
  const active = (params.sort ?? "due") === field;
  const dir = active && params.dir !== "desc" ? "desc" : "asc";
  return (
    <th scope="col" aria-sort={active ? (params.dir === "desc" ? "descending" : "ascending") : "none"} className={cn("border-b border-line bg-[#fafaf7] px-3 py-2 text-[12px] font-semibold uppercase tracking-wide text-muted whitespace-nowrap", align === "right" ? "text-right" : "text-left")}>
      <Link href={`${path}${buildQs(params, { sort: field, dir, page: undefined })}`} className="inline-flex items-center gap-1 hover:text-ink">
        {label}
        <span aria-hidden className={active ? "text-ink" : "opacity-30"}>{active && params.dir === "desc" ? "↓" : "↑"}</span>
      </Link>
    </th>
  );
}

export function Pagination({ path, params, page, pageSize, total }: { path: string; params: Record<string, string | undefined>; page: number; pageSize: number; total: number }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav aria-label="Pagination" className="no-print flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-[13px] text-muted">
      <span>Showing {from}–{to} of {total}</span>
      <div className="flex gap-1">
        {page > 1 ? <Link className="rounded-md border border-line-strong bg-surface px-2.5 py-1 text-ink hover:bg-subtle" href={`${path}${buildQs(params, { page: String(page - 1) })}`}>Previous</Link> : <span className="rounded-md border border-line px-2.5 py-1 opacity-50">Previous</span>}
        <span className="px-2 py-1">Page {page} of {pages}</span>
        {page < pages ? <Link className="rounded-md border border-line-strong bg-surface px-2.5 py-1 text-ink hover:bg-subtle" href={`${path}${buildQs(params, { page: String(page + 1) })}`}>Next</Link> : <span className="rounded-md border border-line px-2.5 py-1 opacity-50">Next</span>}
      </div>
    </nav>
  );
}
