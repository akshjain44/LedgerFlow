import { requireTenant } from "@/server/context";
import { loadSettingsFor } from "@/server/services/collections";
import { Card, LinkButton } from "@/components/ui";
import { BusinessForm } from "@/components/SettingsForms";

export const metadata = { title: "Settings" };

export default async function BusinessSettingsPage() {
  const ctx = await requireTenant();
  const { business } = await loadSettingsFor(ctx);
  return (
    <div className="min-w-0 space-y-5">
      <Card title="Business details">
        <BusinessForm b={business} disabled={!ctx.permissions.has("settings.manage")} />
      </Card>
      <Card title="Another business?" description="Users can belong to several businesses and switch between them from the top bar.">
        <LinkButton href="/onboarding?another=1">Create another business</LinkButton>
      </Card>
    </div>
  );
}
