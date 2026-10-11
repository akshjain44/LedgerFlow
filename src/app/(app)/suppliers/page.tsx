import { requireTenant } from "@/server/context";
import { AccountList } from "@/components/accounts/AccountList";

export const metadata = { title: "Suppliers" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireTenant("payables.view");
  return <AccountList ctx={ctx} kind="supplier" sp={await searchParams} />;
}
