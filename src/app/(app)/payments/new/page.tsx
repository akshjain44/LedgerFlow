import { requireTenant } from "@/server/context";
import { counterpartyOptions } from "@/server/queries/counterparties";
import { loadSettingsFor } from "@/server/services/collections";
import { Card, PageHeader } from "@/components/ui";
import { PaymentForm } from "@/components/PaymentForm";

export const metadata = { title: "Record payment" };

export default async function NewPaymentPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const direction = sp.direction === "made" ? "made" : "received";
  const ctx = await requireTenant("payments.record");
  const [parties, { settings }] = await Promise.all([counterpartyOptions(ctx, direction === "received" ? "customer" : "supplier"), loadSettingsFor(ctx)]);
  const returnTo = sp.returnTo && sp.returnTo.startsWith("/") && !sp.returnTo.startsWith("//") ? sp.returnTo : undefined;
  return (
    <>
      <PageHeader title={direction === "received" ? "Record payment received" : "Record payment made"} breadcrumbs={[{ href: "/payments", label: "Payments" }, { label: "New" }]} description="Record money that has actually moved. Use promises (customers) or planned payments (suppliers) for commitments." />
      <Card>
        <PaymentForm direction={direction} parties={parties} methods={settings.paymentMethods} today={ctx.today} initialCounterpartyId={sp.counterpartyId} initialInvoiceId={sp.invoiceId} returnTo={returnTo} />
      </Card>
    </>
  );
}
