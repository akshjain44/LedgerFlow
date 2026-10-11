import { notFound } from "next/navigation";
import { requireTenant } from "@/server/context";
import { getInvoiceDetail } from "@/server/queries/invoices";
import { memberOptions } from "@/server/queries/counterparties";
import { Card, PageHeader } from "@/components/ui";
import { InvoiceEditForm } from "@/components/invoices/InvoiceForm";
import { fromDbDate } from "@/domain/dates";
import { NotFoundError } from "@/server/errors";

export const metadata = { title: "Edit" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireTenant("payables.manage");
  const { id } = await params;
  const detail = await getInvoiceDetail(ctx, id).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  const { inv } = detail;
  if (inv.direction !== "payable") notFound();
  const members = await memberOptions(ctx);
  return (
    <>
      <PageHeader title={`Edit ${inv.invoiceNumber}`} breadcrumbs={[{ href: "/payables", label: "Payables" }, { href: `/payables/${inv.id}`, label: inv.invoiceNumber }, { label: "Edit" }]} />
      <Card>
        <InvoiceEditForm
          direction="payable"
          members={members}
          inv={{
            id: inv.id,
            invoiceNumber: inv.invoiceNumber,
            invoiceDate: fromDbDate(inv.invoiceDate),
            dueDate: fromDbDate(inv.dueDate),
            paymentTerms: inv.paymentTerms,
            totalAmount: inv.totalAmount.toFixed(2),
            subtotalAmount: inv.subtotalAmount?.toFixed(2) ?? null,
            taxAmount: inv.taxAmount?.toFixed(2) ?? null,
            poReference: inv.poReference,
            deliveryReference: inv.deliveryReference,
            notes: inv.notes,
            assignedUserId: inv.assignedUserId,
            priority: inv.priority,
            remindersEnabled: inv.remindersEnabled,
          }}
        />
      </Card>
    </>
  );
}
