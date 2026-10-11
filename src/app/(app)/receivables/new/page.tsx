import { requireTenant } from "@/server/context";
import { counterpartyOptions, memberOptions } from "@/server/queries/counterparties";
import { loadSettingsFor } from "@/server/services/collections";
import { Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { InvoiceForm } from "@/components/invoices/InvoiceForm";

export const metadata = { title: "New invoice" };

export default async function Page({ searchParams }: { searchParams: Promise<{ counterpartyId?: string }> }) {
  const ctx = await requireTenant("receivables.manage");
  const sp = await searchParams;
  const [parties, members, { business }] = await Promise.all([counterpartyOptions(ctx, "customer"), memberOptions(ctx), loadSettingsFor(ctx)]);
  return (
    <>
      <PageHeader title="New invoice" breadcrumbs={[{ href: "/receivables", label: "Receivables" }, { label: "New" }]} />
      {parties.length === 0 ? (
        <EmptyState title="Add a customer first" action={<LinkButton href="/customers/new" variant="primary">Add customer</LinkButton>}>Every receivable needs a customer record.</EmptyState>
      ) : (
        <Card>
          <InvoiceForm
            direction="receivable"
            parties={parties}
            members={members}
            today={ctx.today}
            defaultCreditDays={business.defaultCustomerCreditDays}
            canOverrideDuplicate={ctx.permissions.has("invoices.override_duplicate")}
            initialCounterpartyId={sp.counterpartyId}
          />
        </Card>
      )}
    </>
  );
}
