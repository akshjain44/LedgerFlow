import { requireTenant } from "@/server/context";
import { InvoiceDetail } from "@/components/invoices/InvoiceDetail";

export const metadata = { title: "Receivable detail" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireTenant("receivables.view");
  const { id } = await params;
  return <InvoiceDetail ctx={ctx} id={id} direction="receivable" />;
}
