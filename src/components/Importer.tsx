"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { previewImportAction, commitImportAction } from "@/actions/misc";
import { buttonClass } from "./ui";
import { cn } from "@/lib/cn";

type ImportType = "customers" | "suppliers" | "receivables" | "payables" | "payments";
interface FieldDef { key: string; label: string; required: boolean; hint?: string }
type Preview = { headers: string[]; mapping: Record<string, string>; results: { rowNumber: number; values: Record<string, string>; errors: string[]; duplicate: string | null }[]; alreadyImported: { at: string; created: number } | null };

export function Importer({ types }: { types: { type: ImportType; label: string; fields: FieldDef[] }[] }) {
  const [type, setType] = useState<ImportType>("customers");
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [skip, setSkip] = useState<Set<number>>(new Set());
  const [summary, setSummary] = useState<{ created: number; skipped: number; failed: number; total: number } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const def = types.find((t) => t.type === type)!;

  const runPreview = (text: string, map: Record<string, string> | null) =>
    start(async () => {
      const r = await previewImportAction(type, text, map);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setPreview(r.data!);
      setMapping(r.data!.mapping);
      setSkip(new Set());
    });

  const reset = () => {
    setCsv(null);
    setPreview(null);
    setSummary(null);
    setFileName("");
  };

  const valid = preview?.results.filter((r) => r.errors.length === 0 && !r.duplicate && !skip.has(r.rowNumber)).length ?? 0;
  const invalid = preview?.results.filter((r) => r.errors.length > 0).length ?? 0;
  const dups = preview?.results.filter((r) => r.duplicate).length ?? 0;

  return (
    <div className="space-y-5">
      <ol className="flex flex-wrap gap-2 text-[12.5px] text-muted" aria-label="Steps">
        {["Choose type", "Upload CSV", "Map columns", "Review rows", "Import"].map((s, i) => {
          const step = summary ? 4 : preview ? 3 : csv ? 2 : 0;
          return <li key={s} className={cn("rounded-full border px-2.5 py-0.5", i <= step ? "border-accent bg-accent-soft text-accent-strong" : "border-line")}>{i + 1}. {s}</li>;
        })}
      </ol>

      {summary ? (
        <div className="rounded-lg border border-line bg-surface p-5">
          <h2 className="text-[16px] font-semibold">Import finished</h2>
          <dl className="mt-3 grid gap-3 sm:grid-cols-4">
            <div><dt className="text-[12.5px] text-muted">Rows in file</dt><dd className="text-xl font-semibold">{summary.total}</dd></div>
            <div><dt className="text-[12.5px] text-muted">Created</dt><dd className="text-xl font-semibold text-ok">{summary.created}</dd></div>
            <div><dt className="text-[12.5px] text-muted">Skipped (duplicates / by you)</dt><dd className="text-xl font-semibold">{summary.skipped}</dd></div>
            <div><dt className="text-[12.5px] text-muted">Failed (see history below)</dt><dd className={cn("text-xl font-semibold", summary.failed && "text-bad")}>{summary.failed}</dd></div>
          </dl>
          <p className="mt-3 text-[13px] text-muted">Every row&apos;s outcome is stored with the batch. Invalid rows were not imported — fix them in your spreadsheet and import a corrected file.</p>
          <button className={cn(buttonClass("primary"), "mt-4")} onClick={reset}>Import another file</button>
        </div>
      ) : (
        <>
          <div className="grid gap-4 rounded-lg border border-line bg-surface p-4 sm:grid-cols-[220px_1fr]">
            <label className="text-[13px] font-medium text-ink-2">What are you importing?
              <select value={type} disabled={!!csv} onChange={(e) => setType(e.target.value as ImportType)} className="mt-1 block h-9 w-full rounded-md border border-line-strong bg-surface px-2 text-[14px]">
                {types.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
              </select>
            </label>
            <div className="text-[13px]">
              <p className="font-medium text-ink-2">Columns</p>
              <p className="mt-1 text-muted">{def.fields.map((f) => `${f.label}${f.required ? "*" : ""}`).join(" · ")}</p>
              <p className="mt-1 text-muted">Dates: DD/MM/YYYY or YYYY-MM-DD. Amounts in rupees, e.g. 125000.50. {type === "payments" && "Payments are allocated only to the invoice number given in that row."}</p>
              <a href={`/api/import-template/${type}`} className="mt-2 inline-block font-medium text-accent hover:underline">Download {def.label.toLowerCase()} template (CSV)</a>
            </div>
          </div>

          {!csv && (
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-line-strong bg-surface px-6 py-10 text-center hover:border-accent">
              <span className="text-[15px] font-semibold">Choose a CSV file</span>
              <span className="mt-1 text-[13px] text-muted">Up to 5 MB / 5,000 rows. Nothing is saved until you confirm.</span>
              <input
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  if (f.size > 5 * 1024 * 1024) {
                    toast.error("File is larger than 5 MB");
                    return;
                  }
                  const text = await f.text();
                  setCsv(text);
                  setFileName(f.name);
                  runPreview(text, null);
                }}
              />
            </label>
          )}

          {pending && <p className="text-[13.5px] text-muted">Checking rows…</p>}

          {csv && preview && (
            <>
              {preview.alreadyImported && <div role="alert" className="rounded-md border border-[#f3c7c2] bg-bad-soft px-3 py-2 text-[13px] text-bad">This exact file was already imported on {new Date(preview.alreadyImported.at).toLocaleString("en-IN")} ({preview.alreadyImported.created} rows created). Importing it again is blocked.</div>}
              <div className="rounded-lg border border-line bg-surface p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-[15px] font-semibold">Map columns — {fileName}</h2>
                  <button className={buttonClass("ghost", "sm")} onClick={reset}>Choose a different file</button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {def.fields.map((f) => (
                    <label key={f.key} className="text-[13px] font-medium text-ink-2">
                      {f.label}{f.required && <span className="text-bad"> *</span>}
                      <select value={mapping[f.key] ?? ""} onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value })} className={cn("mt-1 block h-9 w-full rounded-md border bg-surface px-2 text-[13.5px]", f.required && !mapping[f.key] ? "border-bad" : "border-line-strong")}>
                        <option value="">— not in file —</option>
                        {preview.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                      </select>
                      {f.hint && <span className="mt-0.5 block text-[12px] font-normal text-muted">{f.hint}</span>}
                    </label>
                  ))}
                </div>
                <button className={cn(buttonClass("secondary", "sm"), "mt-3")} onClick={() => runPreview(csv, mapping)} disabled={pending}>Re-check with this mapping</button>
              </div>

              <div className="rounded-lg border border-line bg-surface">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
                  <p className="text-[13.5px]"><strong className="text-ok">{valid}</strong> ready · <strong className="text-bad">{invalid}</strong> with errors (will not be imported) · <strong>{dups}</strong> duplicates (skipped){skip.size > 0 && <> · {skip.size} skipped by you</>}</p>
                  <button
                    className={buttonClass("primary")}
                    disabled={pending || valid === 0 || !!preview.alreadyImported}
                    onClick={() =>
                      start(async () => {
                        const r = await commitImportAction(type, csv, fileName, mapping, [...skip]);
                        if (!r.ok) toast.error(r.error);
                        else {
                          toast.success(`Imported ${r.data!.created} rows`);
                          setSummary(r.data!);
                          router.refresh();
                        }
                      })
                    }
                  >
                    Import {valid} row{valid === 1 ? "" : "s"}
                  </button>
                </div>
                <div className="max-h-[480px] overflow-auto">
                  <table className="w-full min-w-[800px] text-[13px]">
                    <thead className="sticky top-0 bg-[#fafaf7]">
                      <tr className="text-left text-[12px] uppercase tracking-wide text-muted"><th className="px-3 py-2">Row</th><th className="px-3 py-2">Import?</th><th className="px-3 py-2">Result</th>{def.fields.slice(0, 6).map((f) => <th key={f.key} className="px-3 py-2">{f.label}</th>)}</tr>
                    </thead>
                    <tbody>
                      {preview.results.map((r) => {
                        const ok = r.errors.length === 0 && !r.duplicate;
                        return (
                          <tr key={r.rowNumber} className={cn("border-t border-line align-top", !ok && "bg-bad-soft/40", r.duplicate && "bg-warn-soft/50")}>
                            <td className="px-3 py-2 text-muted">{r.rowNumber}</td>
                            <td className="px-3 py-2">{ok ? <input type="checkbox" aria-label={`Import row ${r.rowNumber}`} checked={!skip.has(r.rowNumber)} onChange={(e) => { const s = new Set(skip); if (e.target.checked) s.delete(r.rowNumber); else s.add(r.rowNumber); setSkip(s); }} /> : "—"}</td>
                            <td className="px-3 py-2">{ok ? <span className="text-ok">Ready</span> : r.duplicate ? <span className="text-warn">{r.duplicate}</span> : <ul className="text-bad">{r.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}</td>
                            {def.fields.slice(0, 6).map((f) => <td key={f.key} className="px-3 py-2">{r.values[f.key]}</td>)}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
