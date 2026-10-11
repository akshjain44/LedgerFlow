import { requireTenant } from "@/server/context";
import { loadSettingsFor } from "@/server/services/collections";
import { Card } from "@/components/ui";
import { FinancialForm } from "@/components/SettingsForms";
import { DEFAULT_PRIORITY_WEIGHTS } from "@/domain/priority";

export const metadata = { title: "Financial settings" };

export default async function FinancialPage() {
  const ctx = await requireTenant();
  const { settings } = await loadSettingsFor(ctx);
  return (
    <div className="space-y-5">
      <Card title="Payments & numbering">
        <FinancialForm methods={settings.paymentMethods} prefix={settings.invoicePrefix} weights={settings.priorityWeights ? JSON.stringify(settings.priorityWeights, null, 2) : ""} disabled={!ctx.permissions.has("settings.manage")} />
      </Card>
      <Card title="Default priority weights" description="Used by the collections queue unless overridden above.">
        <pre className="overflow-x-auto rounded-md bg-subtle p-3 text-[12px]">{JSON.stringify(DEFAULT_PRIORITY_WEIGHTS, null, 2)}</pre>
      </Card>
      <Card title="Ageing buckets & currency">
        <p className="text-[13.5px] text-ink-2">Ageing uses Not yet due · Due today · 1–30 · 31–60 · 61–90 · 90+ days past due. Amounts are INR with two decimal places; inputs with more precision are rejected rather than rounded.</p>
      </Card>
    </div>
  );
}
