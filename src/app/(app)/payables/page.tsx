import { requireTenant } from "@/server/context";
import { InvoiceList } from "@/components/invoices/InvoiceList";

export const metadata = { title: "Payables" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireTenant("payables.view");
  return <InvoiceList ctx={ctx} direction="payable" sp={await searchParams} />;
}
