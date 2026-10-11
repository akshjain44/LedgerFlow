import { notFound } from "next/navigation";
import { requireTenant } from "@/server/context";
import { getCounterpartyProfile, memberOptions } from "@/server/queries/counterparties";
import { Card, PageHeader } from "@/components/ui";
import { AccountForm } from "@/components/accounts/AccountForm";
import { NotFoundError } from "@/server/errors";

export const metadata = { title: "Edit supplier" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireTenant("payables.manage");
  const { id } = await params;
  const { cp } = await getCounterpartyProfile(ctx, id).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  const members = await memberOptions(ctx);
  return (
    <>
      <PageHeader title={`Edit ${cp.name}`} breadcrumbs={[{ href: "/suppliers", label: "Suppliers" }, { href: `/suppliers/${cp.id}`, label: cp.name }, { label: "Edit" }]} />
      <Card>
        <AccountForm kind="supplier" members={members} canCustomer={ctx.permissions.has("receivables.manage")} canSupplier={ctx.permissions.has("payables.manage")} values={{ ...cp, creditLimit: cp.creditLimit?.toFixed(2) ?? null }} />
      </Card>
    </>
  );
}
