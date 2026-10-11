import { requireTenant } from "@/server/context";
import { AccountProfile } from "@/components/accounts/AccountProfile";

export const metadata = { title: "Customer" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireTenant("receivables.view");
  const { id } = await params;
  return <AccountProfile ctx={ctx} id={id} kind="customer" />;
}
