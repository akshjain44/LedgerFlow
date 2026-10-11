import { requireTenant } from "@/server/context";
import { memberOptions } from "@/server/queries/counterparties";
import { Card, PageHeader } from "@/components/ui";
import { AccountForm } from "@/components/accounts/AccountForm";

export const metadata = { title: "Add supplier" };

export default async function Page() {
  const ctx = await requireTenant("payables.manage");
  const members = await memberOptions(ctx);
  return (
    <>
      <PageHeader title="Add supplier" breadcrumbs={[{ href: "/suppliers", label: "Suppliers" }, { label: "New" }]} />
      <Card><AccountForm kind="supplier" members={members} canCustomer={ctx.permissions.has("receivables.manage")} canSupplier={ctx.permissions.has("payables.manage")} /></Card>
    </>
  );
}
