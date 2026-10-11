import { requireTenant } from "@/server/context";
import { AccountList } from "@/components/accounts/AccountList";

export const metadata = { title: "Customers" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireTenant("receivables.view");
  return <AccountList ctx={ctx} kind="customer" sp={await searchParams} />;
}
