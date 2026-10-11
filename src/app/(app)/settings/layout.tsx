import { requireTenant } from "@/server/context";
import { PageHeader } from "@/components/ui";
import { SettingsNav } from "@/components/SettingsNav";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireTenant();
  const items = [
    { href: "/settings", label: "Business" },
    { href: "/settings/members", label: "Members & roles" },
    { href: "/settings/reminders", label: "Reminders & escalation" },
    { href: "/settings/financial", label: "Financial" },
    { href: "/settings/integrations", label: "Integrations" },
    ...(ctx.permissions.has("audit.view") ? [{ href: "/settings/audit", label: "Audit log" }] : []),
    { href: "/settings/data", label: "Data & retention" },
  ];
  return (
    <>
      <PageHeader title="Settings" description={ctx.permissions.has("settings.manage") ? undefined : "You can view these settings. Only an owner can change them."} />
      <div className="grid gap-5 lg:grid-cols-[220px_1fr]">
        <SettingsNav items={items} />
        <div className="min-w-0">{children}</div>
      </div>
    </>
  );
}
