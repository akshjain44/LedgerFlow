import { requireTenant } from "@/server/context";
import { unreadCount } from "@/server/services/notifications";
import { Shell } from "@/components/Shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireTenant();
  const unread = await unreadCount(ctx);
  return <Shell ctx={ctx} unread={unread}>{children}</Shell>;
}
