import { requireTenant } from "@/server/context";
import { Card, LinkButton } from "@/components/ui";

export const metadata = { title: "Data & retention" };

export default async function DataPage() {
  const ctx = await requireTenant();
  return (
    <div className="min-w-0 space-y-5">
      <Card title="Data retention & deletion policy">
        <ul className="list-disc space-y-1.5 pl-5 text-[13.5px] text-ink-2">
          <li>Financial history (invoices, payments, allocations, credit notes, write-offs) is never hard-deleted by the application. Corrections are made with reversals, which stay visible.</li>
          <li>Invoices can be voided with a reason; void invoices remain on record and are excluded from balances.</li>
          <li>The audit log is append-only at the database level.</li>
          <li>Removed documents are hidden from the record but kept in storage with their audit entries; permanent removal requires a database administrator.</li>
          <li>Each business&apos;s data is isolated by Row Level Security. Deleting a business and all of its records is an administrative operation performed on request, after export.</li>
          <li>Logs never contain passwords, session tokens or document contents. Sessions expire after 14 days.</li>
        </ul>
        <p className="mt-3 text-[12.5px] text-muted">This is an operational receivables and payables tool. It is not a certified accounting system and does not claim GST or other regulatory compliance.</p>
      </Card>
      {ctx.permissions.has("exports.run") && (
        <Card title="Export your data" description="CSV exports of every core record.">
          <div className="flex flex-wrap gap-2">
            {["customers", "suppliers", "receivables", "payables", "payments", "followups", "promises", "disputes"].map((k) => <LinkButton key={k} href={`/api/export/${k}`} prefetch={false} size="sm">{k}</LinkButton>)}
          </div>
        </Card>
      )}
    </div>
  );
}
