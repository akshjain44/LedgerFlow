import { requireTenant } from "@/server/context";
import { InvoiceList } from "@/components/invoices/InvoiceList";

export const metadata = { title: "Receivables" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireTenant("receivables.view");
  return <InvoiceList ctx={ctx} direction="receivable" sp={await searchParams} />;
}
