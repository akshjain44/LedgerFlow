import Link from "next/link";
import { Download, Plus } from "lucide-react";
import type { TenantContext } from "@/server/context";
import { listCounterparties, memberOptions } from "@/server/queries/counterparties";
import { Badge, Card, EmptyState, LinkButton, PageHeader, Table, Td, Th } from "@/components/ui";
import { Money } from "@/components/format";
import { FilterChips, Pagination } from "@/components/ListControls";

export async function AccountList({ ctx, kind, sp }: { ctx: TenantContext; kind: "customer" | "supplier"; sp: Record<string, string | undefined> }) {
  const params = { q: sp.q, status: sp.status, assignee: sp.assignee, sort: sp.sort };
  const [data, members] = await Promise.all([listCounterparties(ctx, kind, { ...params, page: Number(sp.page) || 1 }), memberOptions(ctx)]);
  const path = `/${kind}s`;
  const canManage = ctx.permissions.has(kind === "customer" ? "receivables.manage" : "payables.manage");
  return (
    <>
      <PageHeader
        title={kind === "customer" ? "Customers" : "Suppliers"}
        description={kind === "customer" ? "Who owes you money and how they pay." : "Who you owe money to and when it is due."}
        actions={
          <>
            {ctx.permissions.has("exports.run") && <LinkButton href={`/api/export/${kind}s`} prefetch={false}><Download className="h-4 w-4" />Export CSV</LinkButton>}
            {canManage && <LinkButton href={`${path}/new`} variant="primary"><Plus className="h-4 w-4" />Add {kind}</LinkButton>}
          </>
        }
      />
      <div className="mb-3"><FilterChips path={path} params={params} param="status" current={sp.status ?? ""} options={[{ key: "", label: "All" }, { key: "active", label: "Active" }, { key: "on_hold", label: "On hold" }, { key: "inactive", label: "Inactive" }]} /></div>
      <form action={path} className="no-print mb-4 flex flex-wrap gap-2 rounded-lg border border-line bg-surface p-3">
        {sp.status && <input type="hidden" name="status" value={sp.status} />}
        <input name="q" defaultValue={sp.q} placeholder="Name, code, GSTIN, phone, contact" aria-label="Search" className="h-9 min-w-[220px] flex-1 rounded-md border border-line-strong px-3 text-[13.5px]" />
        <select name="assignee" defaultValue={sp.assignee ?? ""} aria-label="Assigned employee" className="h-9 rounded-md border border-line-strong bg-surface px-2 text-[13.5px]"><option value="">Anyone</option><option value="unassigned">Unassigned</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
        <select name="sort" defaultValue={sp.sort ?? ""} aria-label="Sort" className="h-9 rounded-md border border-line-strong bg-surface px-2 text-[13.5px]"><option value="">Sort by name</option><option value="outstanding">Largest outstanding</option><option value="overdue">Largest overdue</option></select>
        <button className="h-9 rounded-md bg-ink px-3 text-[13.5px] font-medium text-white">Apply</button>
      </form>
      <Card padded={false}>
        {data.total === 0 ? (
          <div className="p-4"><EmptyState title={sp.q ? "No matches" : `No ${kind}s yet`} action={canManage ? <LinkButton href={`${path}/new`} variant="primary">Add {kind}</LinkButton> : undefined}>{sp.q ? "Try a different search." : "Add one, or import a list from Imports."}</EmptyState></div>
        ) : (
          <>
            <Table>
              <thead><tr><Th>Name</Th><Th>Contact</Th><Th>Code / GSTIN</Th><Th align="right">Outstanding</Th><Th align="right">Overdue</Th><Th align="right">Open</Th><Th>Terms</Th><Th>Status</Th><Th>Assigned</Th></tr></thead>
              <tbody>
                {data.rows.map((c) => (
                  <tr key={c.id} className="hover:bg-[#fbfbf8]">
                    <Td><Link href={`${path}/${c.id}`} className="font-medium text-accent hover:underline">{c.name}</Link>{c.isCustomer && c.isSupplier && <span className="ml-1"><Badge tone="info">Customer & supplier</Badge></span>}</Td>
                    <Td>{c.contactPerson ?? "—"}{c.phone && <a href={`tel:${c.phone.replace(/\s/g, "")}`} className="block text-[12px] text-accent hover:underline">{c.phone}</a>}</Td>
                    <Td className="text-[12.5px]">{c.accountCode ?? "—"}{c.gstin && <span className="block text-muted">{c.gstin}</span>}</Td>
                    <Td align="right"><Money value={c.outstanding} /></Td>
                    <Td align="right"><Money value={c.overdue} tone="bad" /></Td>
                    <Td align="right">{c.openCount}</Td>
                    <Td className="text-[12.5px]">{(kind === "customer" ? c.customerCreditDays : c.supplierCreditDays) ?? "Default"} days{c.creditLimitP !== null && <span className="block text-muted">limit <Money value={c.creditLimitP} compact /></span>}</Td>
                    <Td><Badge tone={c.status === "active" ? "ok" : c.status === "on_hold" ? "warn" : "neutral"}>{c.status.replace("_", " ")}</Badge></Td>
                    <Td>{c.assigneeName ?? <span className="text-muted">—</span>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination path={path} params={params} page={data.page} pageSize={data.pageSize} total={data.total} />
          </>
        )}
      </Card>
    </>
  );
}
