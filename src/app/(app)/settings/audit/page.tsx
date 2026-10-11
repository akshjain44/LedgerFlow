import { requireTenant } from "@/server/context";
import { withTenant } from "@/server/db";
import { Card, Table, Td, Th } from "@/components/ui";
import { DateTimeText } from "@/components/format";
import { Pagination } from "@/components/ListControls";

export const metadata = { title: "Audit log" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireTenant("audit.view");
  const sp = await searchParams;
  const page = Math.max(Number(sp.page) || 1, 1);
  const where = { ...(sp.action ? { action: { startsWith: sp.action } } : {}), ...(sp.q ? { summary: { contains: sp.q, mode: "insensitive" as const } } : {}) };
  const [rows, total, users] = await withTenant(ctx.businessId, (tx) =>
    Promise.all([
      tx.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * 50, take: 50 }),
      tx.auditLog.count({ where }),
      tx.membership.findMany({ where: { businessId: ctx.businessId }, include: { user: { select: { id: true, name: true } } } }),
    ]),
  );
  const name = (id: string | null) => (id ? users.find((u) => u.userId === id)?.user.name ?? "Former member" : "System");
  return (
    <Card title="Audit log" description="Append-only record of material changes. Entries cannot be edited or deleted." padded={false}>
      <form className="flex flex-wrap gap-2 border-b border-line p-3">
        <input name="q" defaultValue={sp.q} placeholder="Search summaries" aria-label="Search" className="h-9 flex-1 rounded-md border border-line-strong px-3 text-[13.5px]" />
        <select name="action" defaultValue={sp.action ?? ""} aria-label="Event type" className="h-9 rounded-md border border-line-strong bg-surface px-2 text-[13.5px]">
          <option value="">All events</option><option value="invoice">Invoices</option><option value="bill">Bills</option><option value="payment">Payments</option><option value="allocation">Allocations</option><option value="adjustment">Adjustments</option><option value="promise">Promises</option><option value="dispute">Disputes</option><option value="followup">Follow-ups</option><option value="member">Members</option><option value="settings">Settings</option><option value="import">Imports</option><option value="document">Documents</option><option value="reminders">Reminder runs</option>
        </select>
        <button className="h-9 rounded-md bg-ink px-3 text-[13.5px] font-medium text-white">Filter</button>
      </form>
      <Table>
        <thead><tr><Th>When</Th><Th>Who</Th><Th>Event</Th><Th>Summary</Th><Th>Changes</Th></tr></thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id}>
              <Td className="text-[12.5px]"><DateTimeText value={a.createdAt} tz={ctx.timezone} /></Td>
              <Td className="text-[12.5px]">{name(a.actorUserId)}</Td>
              <Td className="font-mono text-[12px]">{a.action}</Td>
              <Td className="max-w-md text-[13px]">{a.summary}</Td>
              <Td className="max-w-xs text-[11.5px] text-muted">{a.before || a.after ? <details><summary className="cursor-pointer text-accent">before / after</summary><pre className="mt-1 whitespace-pre-wrap break-all">{JSON.stringify({ before: a.before, after: a.after }, null, 1)}</pre></details> : "—"}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Pagination path="/settings/audit" params={{ q: sp.q, action: sp.action }} page={page} pageSize={50} total={total} />
    </Card>
  );
}
