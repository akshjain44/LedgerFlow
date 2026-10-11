import Link from "next/link";
import type { InvoiceDirection } from "@prisma/client";
import { Download, Plus } from "lucide-react";
import type { TenantContext } from "@/server/context";
import { listInvoices, INVOICE_FILTERS, AGEING_FILTERS } from "@/server/queries/invoices";
import { counterpartyOptions, memberOptions } from "@/server/queries/counterparties";
import { Badge, Card, EmptyState, LinkButton, PageHeader, Td } from "@/components/ui";
import { DateText, DateTimeText, DaysLabel, Money, PromiseBadge, StatusBadge, PRIORITY_TONE } from "@/components/format";
import { FilterChips, Pagination, SortHeader, buildQs } from "@/components/ListControls";
import { BulkBar, RowSelect } from "@/components/BulkBar";
import { MobileFilters } from "@/components/MobileFilters";

export async function InvoiceList({ ctx, direction, sp }: { ctx: TenantContext; direction: InvoiceDirection; sp: Record<string, string | undefined> }) {
  const recv = direction === "receivable";
  const path = recv ? "/receivables" : "/payables";
  const params = { q: sp.q, filter: sp.filter, counterpartyId: sp.counterpartyId, assignee: sp.assignee, bucket: sp.bucket, min: sp.min, max: sp.max, priority: sp.priority, sort: sp.sort, dir: sp.dir };
  const [data, parties, members] = await Promise.all([
    listInvoices(ctx, direction, { ...params, page: Number(sp.page) || 1 }),
    counterpartyOptions(ctx, recv ? "customer" : "supplier"),
    memberOptions(ctx),
  ]);
  const canManage = ctx.permissions.has(recv ? "receivables.manage" : "payables.manage");
  const party = recv ? "Customer" : "Supplier";

  return (
    <>
      <PageHeader
        title={recv ? "Receivables" : "Payables"}
        description={recv ? "Money customers owe the business. Overdue = positive balance past its due date; due today is not overdue." : "Money the business owes suppliers. Planned payments are plans, not payments."}
        actions={
          <>
            {ctx.permissions.has("exports.run") && <LinkButton href={`/api/export/${recv ? "receivables" : "payables"}${buildQs(params, {})}`} prefetch={false}><Download className="h-4 w-4" />Export CSV</LinkButton>}
            {!recv && ctx.permissions.has("reports.view") && <LinkButton href="/reports/cash-flow">Cash-flow outlook</LinkButton>}
            {canManage && <LinkButton href={`${path}/new`} variant="primary"><Plus className="h-4 w-4" />{recv ? "New invoice" : "New bill"}</LinkButton>}
          </>
        }
      />
      <div className="mb-3">
        <FilterChips path={path} params={params} options={INVOICE_FILTERS[direction]} current={sp.filter ?? "open"} />
      </div>
      <MobileFilters active={!!(sp.q || sp.counterpartyId || sp.assignee || sp.bucket || sp.min || sp.max || sp.priority)}>
      <form action={path} className="no-print mb-4 grid gap-2 rounded-lg border border-line bg-surface p-3 sm:grid-cols-2 lg:grid-cols-6" role="search">
        {sp.filter && <input type="hidden" name="filter" value={sp.filter} />}
        <label className="lg:col-span-2"><span className="sr-only">Search</span><input name="q" defaultValue={sp.q} placeholder={`Invoice no., ${party.toLowerCase()}, PO or challan ref.`} className="h-9 w-full rounded-md border border-line-strong px-3 text-[13.5px]" /></label>
        <label><span className="sr-only">{party}</span>
          <select name="counterpartyId" defaultValue={sp.counterpartyId ?? ""} className="h-9 w-full rounded-md border border-line-strong bg-surface px-2 text-[13.5px]">
            <option value="">All {party.toLowerCase()}s</option>
            {parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label><span className="sr-only">Assigned employee</span>
          <select name="assignee" defaultValue={sp.assignee ?? ""} className="h-9 w-full rounded-md border border-line-strong bg-surface px-2 text-[13.5px]">
            <option value="">Anyone assigned</option>
            <option value="unassigned">Unassigned</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
        <label><span className="sr-only">Ageing bucket</span>
          <select name="bucket" defaultValue={sp.bucket ?? ""} className="h-9 w-full rounded-md border border-line-strong bg-surface px-2 text-[13.5px]">
            {AGEING_FILTERS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
          </select>
        </label>
        <div className="flex gap-2">
          <label className="flex-1"><span className="sr-only">Minimum outstanding</span><input name="min" defaultValue={sp.min} inputMode="decimal" placeholder="Min ₹" className="h-9 w-full rounded-md border border-line-strong px-2 text-[13.5px]" /></label>
          <label className="flex-1"><span className="sr-only">Maximum outstanding</span><input name="max" defaultValue={sp.max} inputMode="decimal" placeholder="Max ₹" className="h-9 w-full rounded-md border border-line-strong px-2 text-[13.5px]" /></label>
        </div>
        {!recv && (
          <label><span className="sr-only">Priority</span>
            <select name="priority" defaultValue={sp.priority ?? ""} className="h-9 w-full rounded-md border border-line-strong bg-surface px-2 text-[13.5px]">
              <option value="">Any priority</option><option value="critical">Critical</option><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option>
            </select>
          </label>
        )}
        <div className="flex gap-2 lg:col-span-1">
          <button className="h-9 flex-1 rounded-md bg-ink px-3 text-[13.5px] font-medium text-white">Apply</button>
          <Link href={path} className="flex h-9 items-center rounded-md border border-line-strong px-3 text-[13.5px]">Reset</Link>
        </div>
      </form>
      </MobileFilters>

      <Card padded={false}>
        {data.total === 0 ? (
          <div className="p-4">
            <EmptyState title={sp.q || sp.filter || sp.counterpartyId ? "No invoices match these filters" : recv ? "No receivable invoices yet" : "No supplier bills yet"} action={canManage ? <LinkButton href={`${path}/new`} variant="primary">{recv ? "Create invoice" : "Record bill"}</LinkButton> : undefined}>
              {sp.q || sp.filter ? "Try clearing a filter." : "Create one, or import your spreadsheet from Imports."}
            </EmptyState>
          </div>
        ) : (
          <>
            {(canManage || ctx.permissions.has("collections.work")) && <BulkBar direction={direction} members={members} today={ctx.today} canManage={canManage} canWork={ctx.permissions.has("collections.work")} />}
            <div className="flex items-center justify-between px-3 py-2 text-[13px] text-muted">
              <span>{data.total} {recv ? "invoices" : "bills"} · outstanding <Money value={data.sumOutstanding} className="font-semibold text-ink" /></span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px] border-collapse text-[13.5px]">
                <thead>
                  <tr>
                    <th className="w-8 border-b border-line bg-[#fafaf7] px-3 py-2"><span className="sr-only">Select</span></th>
                    <SortHeader path={path} params={params} field="customer" label={party} />
                    <SortHeader path={path} params={params} field="number" label={recv ? "Invoice" : "Bill no."} />
                    <SortHeader path={path} params={params} field="date" label={recv ? "Invoice date" : "Bill date"} />
                    <SortHeader path={path} params={params} field="due" label="Due date" />
                    <SortHeader path={path} params={params} field="total" label="Amount" align="right" />
                    <th className="border-b border-line bg-[#fafaf7] px-3 py-2 text-right text-[12px] font-semibold uppercase tracking-wide text-muted">Paid</th>
                    <SortHeader path={path} params={params} field="outstanding" label="Outstanding" align="right" />
                    <th className="border-b border-line bg-[#fafaf7] px-3 py-2 text-left text-[12px] font-semibold uppercase tracking-wide text-muted">Status</th>
                    {recv ? (
                      <>
                        <th className="border-b border-line bg-[#fafaf7] px-3 py-2 text-left text-[12px] font-semibold uppercase tracking-wide text-muted">Last follow-up</th>
                        <th className="border-b border-line bg-[#fafaf7] px-3 py-2 text-left text-[12px] font-semibold uppercase tracking-wide text-muted">Next action</th>
                        <th className="border-b border-line bg-[#fafaf7] px-3 py-2 text-left text-[12px] font-semibold uppercase tracking-wide text-muted">Promise</th>
                      </>
                    ) : (
                      <>
                        <SortHeader path={path} params={params} field="priority" label="Priority" />
                        <th className="border-b border-line bg-[#fafaf7] px-3 py-2 text-left text-[12px] font-semibold uppercase tracking-wide text-muted">Planned payment</th>
                      </>
                    )}
                    <th className="border-b border-line bg-[#fafaf7] px-3 py-2 text-left text-[12px] font-semibold uppercase tracking-wide text-muted">Assigned</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.id} className="hover:bg-[#fbfbf8]">
                      <Td><RowSelect id={r.id} label={`Select ${r.invoiceNumber}`} /></Td>
                      <Td><Link href={`/${recv ? "customers" : "suppliers"}/${r.counterparty.id}`} className="font-medium hover:underline">{r.counterparty.name}</Link></Td>
                      <Td><Link href={`${path}/${r.id}`} className="font-medium text-accent hover:underline">{r.invoiceNumber}</Link></Td>
                      <Td><DateText value={r.invoiceDate} /></Td>
                      <Td><DateText value={r.dueDate} />{r.daysPastDue !== null && <span className="block text-[12px]"><DaysLabel days={r.daysPastDue} /></span>}</Td>
                      <Td align="right"><Money value={r.total} /></Td>
                      <Td align="right"><Money value={r.paid} tone="muted" /></Td>
                      <Td align="right" className="font-semibold"><Money value={r.outstanding} /></Td>
                      <Td>
                        <div className="flex flex-wrap gap-1">
                          <StatusBadge status={r.status} partiallyPaid={r.settlement === "partially_paid"} />
                          {r.disputed && <Badge tone="warn" title={r.onHold ? "Collections on hold" : "Open dispute"}>Disputed{r.onHold ? " · hold" : ""}</Badge>}
                        </div>
                      </Td>
                      {recv ? (
                        <>
                          <Td>{r.lastContact ? <DateTimeText value={r.lastContact} tz={ctx.timezone} /> : <span className="text-muted">—</span>}</Td>
                          <Td>{r.nextAction ? <span title={r.nextAction.title}><DateText value={r.nextAction.date} /></span> : <span className="text-muted">—</span>}</Td>
                          <Td>{r.promise ? <><PromiseBadge status={r.promise.status} date={r.promise.date} today={ctx.today} /><span className="block text-[12px] text-muted"><DateText value={r.promise.date} /></span></> : <span className="text-muted">—</span>}</Td>
                        </>
                      ) : (
                        <>
                          <Td><Badge tone={PRIORITY_TONE[r.priority]}>{r.priority}</Badge></Td>
                          <Td>{r.plannedPayment ? <><DateText value={r.plannedPayment.date} /><span className="block text-[12px] text-muted"><Money value={r.plannedPayment.amount} /></span></> : <span className="text-muted">—</span>}</Td>
                        </>
                      )}
                      <Td>{r.assignee?.name ?? <span className="text-muted">—</span>}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination path={path} params={params} page={data.page} pageSize={data.pageSize} total={data.total} />
          </>
        )}
      </Card>
    </>
  );
}
