import { requireTenant } from "@/server/context";
import { loadSettingsFor } from "@/server/services/collections";
import { withTenant } from "@/server/db";
import { Card, Notice } from "@/components/ui";
import { DateTimeText } from "@/components/format";
import { RemindersForm, RunRemindersButton } from "@/components/SettingsForms";

export const metadata = { title: "Reminder settings" };

export default async function RemindersPage() {
  const ctx = await requireTenant();
  const { settings } = await loadSettingsFor(ctx);
  const lastRun = await withTenant(ctx.businessId, (tx) => tx.auditLog.findFirst({ where: { action: "reminders.run" }, orderBy: { createdAt: "desc" } }));
  return (
    <div className="min-w-0 space-y-5">
      <Card title="Reminder processor" description="Runs on the server on a schedule (see README: cron calling /api/cron/reminders). Safe to run repeatedly — nothing is sent twice.">
        <p className="text-[13.5px]">Last run: {lastRun ? <><DateTimeText value={lastRun.createdAt} tz={ctx.timezone} /> — {lastRun.summary}</> : <span className="text-warn">never</span>}</p>
        {ctx.permissions.has("settings.manage") && <div className="mt-3"><RunRemindersButton /></div>}
      </Card>
      <Card title="Schedule & escalation">
        <Notice tone="info">These are starting defaults, not rules. Reminders go to the responsible employee (and finance managers for older overdue items); customers are never contacted automatically.</Notice>
        <div className="mt-4"><RemindersForm s={settings} disabled={!ctx.permissions.has("settings.manage")} /></div>
      </Card>
    </div>
  );
}
