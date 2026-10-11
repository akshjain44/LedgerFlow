import { requireTenant } from "@/server/context";
import { AccountProfile } from "@/components/accounts/AccountProfile";

export const metadata = { title: "Supplier" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireTenant("payables.view");
  const { id } = await params;
  return <AccountProfile ctx={ctx} id={id} kind="supplier" />;
}
