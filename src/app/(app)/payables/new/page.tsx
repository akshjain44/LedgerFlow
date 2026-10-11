import { requireTenant } from "@/server/context";
import { counterpartyOptions, memberOptions } from "@/server/queries/counterparties";
import { loadSettingsFor } from "@/server/services/collections";
import { Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { InvoiceForm } from "@/components/invoices/InvoiceForm";

export const metadata = { title: "New supplier bill" };

export default async function Page({ searchParams }: { searchParams: Promise<{ counterpartyId?: string }> }) {
  const ctx = await requireTenant("payables.manage");
  const sp = await searchParams;
  const [parties, members, { business }] = await Promise.all([counterpartyOptions(ctx, "supplier"), memberOptions(ctx), loadSettingsFor(ctx)]);
  return (
    <>
      <PageHeader title="New supplier bill" breadcrumbs={[{ href: "/payables", label: "Payables" }, { label: "New" }]} />
      {parties.length === 0 ? (
        <EmptyState title="Add a supplier first" action={<LinkButton href="/suppliers/new" variant="primary">Add supplier</LinkButton>}>Every payable needs a supplier record.</EmptyState>
      ) : (
        <Card>
          <InvoiceForm
            direction="payable"
            parties={parties}
            members={members}
            today={ctx.today}
            defaultCreditDays={business.defaultSupplierCreditDays}
            canOverrideDuplicate={ctx.permissions.has("invoices.override_duplicate")}
            initialCounterpartyId={sp.counterpartyId}
          />
        </Card>
      )}
    </>
  );
}
