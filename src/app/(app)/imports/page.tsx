import { requireTenant } from "@/server/context";
import { IMPORT_TYPES, importHistory } from "@/server/services/imports";
import { Badge, Card, PageHeader } from "@/components/ui";
import { DateTimeText } from "@/components/format";
import { Importer } from "@/components/Importer";

export const metadata = { title: "Imports" };

export default async function ImportsPage() {
  const ctx = await requireTenant("imports.run");
  const history = await importHistory(ctx);
  const types = IMPORT_TYPES.filter((t) =>
    t.type === "customers" || t.type === "receivables" ? ctx.permissions.has("receivables.manage") : t.type === "payments" ? ctx.permissions.has("payments.record") : ctx.permissions.has("payables.manage"),
  ).map((t) => ({ type: t.type, label: t.label, fields: t.fields.map((f) => ({ key: f.key, label: f.label, required: f.required, hint: f.hint })) }));
  return (
    <>
      <PageHeader title="Imports" description="Bring in existing spreadsheet records. Import customers and suppliers first, then invoices and bills, then historical payments." />
      <Importer types={types} />
      <Card className="mt-6" title="Import history" padded={false}>
        {history.length === 0 ? <p className="p-4 text-[13.5px] text-muted">No imports yet.</p> : (
          <ul className="divide-y divide-line">
            {history.map((b) => (
              <li key={b.id} className="px-4 py-3 text-[13.5px]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{b.fileName}</span>
                  <Badge tone="info">{b.type}</Badge>
                  <Badge tone={b.status === "completed" ? "ok" : "neutral"}>{b.status}</Badge>
                  <span className="text-muted">{b.createdRows} created · {b.skippedRows} skipped · {b.failedRows} failed of {b.totalRows}</span>
                  <span className="text-[12px] text-muted"><DateTimeText value={b.completedAt ?? b.createdAt} tz={ctx.timezone} /></span>
                </div>
                {b.rows.length > 0 && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-[12.5px] text-accent">Rows not imported ({b.rows.length})</summary>
                    <ul className="mt-1 space-y-0.5 text-[12.5px]">
                      {b.rows.map((r) => <li key={r.id}><span className="text-muted">Row {r.rowNumber}:</span> {r.outcome.replace(/_/g, " ")} — {r.errors.join("; ") || "skipped"}</li>)}
                    </ul>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
