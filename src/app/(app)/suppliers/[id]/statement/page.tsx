import { requireTenant } from "@/server/context";
import { Statement } from "@/components/accounts/Statement";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Statement" };

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const ctx = await requireTenant("payables.view");
  const { id } = await params;
  const sp = await searchParams;
  return (
    <>
      <div className="no-print"><PageHeader title="Statement of account" breadcrumbs={[{ href: "/suppliers", label: "Suppliers" }, { href: `/suppliers/${id}`, label: "Account" }, { label: "Statement" }]} /></div>
      <Statement ctx={ctx} id={id} kind="supplier" from={sp.from} to={sp.to} />
    </>
  );
}
