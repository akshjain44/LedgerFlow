import { requireTenant } from "@/server/context";
import { memberOptions } from "@/server/queries/counterparties";
import { Card, PageHeader } from "@/components/ui";
import { AccountForm } from "@/components/accounts/AccountForm";

export const metadata = { title: "Add customer" };

export default async function Page() {
  const ctx = await requireTenant("receivables.manage");
  const members = await memberOptions(ctx);
  return (
    <>
      <PageHeader title="Add customer" breadcrumbs={[{ href: "/customers", label: "Customers" }, { label: "New" }]} />
      <Card><AccountForm kind="customer" members={members} canCustomer={ctx.permissions.has("receivables.manage")} canSupplier={ctx.permissions.has("payables.manage")} /></Card>
    </>
  );
}
