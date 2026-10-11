import { getTenantContext, type TenantContext } from "@/server/context";
import { withTenant } from "@/server/db";
import { csvResponse, toCsv } from "@/server/csv";
import { listInvoices } from "@/server/queries/invoices";
import { listPayments } from "@/server/queries/payments";
import { ageingReport, counterpartyBalances, followUpProductivity, resolvePeriod } from "@/server/queries/reports";
import { audit } from "@/server/audit";
import { toDecimalString, fromDecimal, type Paise } from "@/domain/money";
import { fromDbDate, isISODate } from "@/domain/dates";
import { AGEING_BUCKETS } from "@/domain/ageing";
import type { Permission } from "@/domain/permissions";

export const dynamic = "force-dynamic";
const money = (p: Paise | null | undefined) => (p === null || p === undefined ? "" : toDecimalString(p));

/** Every export requires exports.run plus the read permission for its data; each export is audited. */
export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const ctx = await getTenantContext();
  if (!ctx) return new Response("Sign in required", { status: 401 });
  const { kind } = await params;
  const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
  const need = (...perms: Permission[]) => perms.every((p) => ctx.permissions.has(p));
  if (!need("exports.run")) return new Response("Forbidden", { status: 403 });
  const out = await build(ctx, kind, sp, need);
  if (!out) return new Response(out === null ? "Forbidden" : "Not found", { status: out === null ? 403 : 404 });
  await withTenant(ctx.businessId, (tx) => audit(tx, { businessId: ctx.businessId, actorUserId: ctx.userId, action: "export.csv", entityType: "export", summary: `Exported ${kind} (${out.rows} rows)` }));
  return csvResponse(`${kind}-${ctx.today}.csv`, out.body);
}

async function build(ctx: TenantContext, kind: string, sp: Record<string, string>, need: (...p: Permission[]) => boolean): Promise<{ body: string; rows: number } | null | undefined> {
  const done = (headers: string[], rows: unknown[][]) => ({ body: toCsv(headers, rows), rows: rows.length });
  switch (kind) {
    case "receivables":
    case "payables": {
      const direction = kind === "receivables" ? "receivable" : "payable";
      if (!need(direction === "receivable" ? "receivables.view" : "payables.view")) return null;
      const all: Awaited<ReturnType<typeof listInvoices>>["rows"] = [];
      for (let page = 1; ; page++) {
        const r = await listInvoices(ctx, direction, { ...sp, page, pageSize: 100 });
        all.push(...r.rows);
        if (page * 100 >= r.total) break;
      }
      return done(
        ["Account", "Invoice number", "Invoice date", "Due date", "Total", "Paid", "Outstanding", "Days past due", "Status", "Disputed", "Last contact", "Next action", "Promise date", "Promise status", "Priority", "Assigned"],
        all.map((r) => [r.counterparty.name, r.invoiceNumber, r.invoiceDate, r.dueDate, money(r.total), money(r.paid), money(r.outstanding), r.daysPastDue ?? "", r.status, r.disputed ? "yes" : "no", r.lastContact?.toISOString() ?? "", r.nextAction?.date ?? "", r.promise?.date ?? "", r.promise?.status ?? "", r.priority, r.assignee?.name ?? ""]),
      );
    }
    case "payments": {
      const r = await listPayments(ctx, { ...sp, status: sp.status ?? "all" });
      const rows = [];
      for (let page = 1; page <= Math.ceil(r.total / r.pageSize) || page === 1; page++) {
        const p = page === 1 ? r : await listPayments(ctx, { ...sp, status: sp.status ?? "all", page });
        rows.push(...p.rows);
        if (page * p.pageSize >= p.total) break;
      }
      return done(
        ["Payment date", "Direction", "Account", "Amount", "Allocated", "Method", "Reference", "Status", "Reversal reason", "Allocations", "Recorded by", "Recorded at"],
        rows.map((p) => [fromDbDate(p.paymentDate), p.direction, p.counterparty.name, money(fromDecimal(p.amount)), money(fromDecimal(p.allocatedAmount)), p.method, p.reference ?? "", p.status, p.reversalReason ?? "", p.allocations.map((a) => `${a.invoice.invoiceNumber}:${a.amount.toFixed(2)}`).join("; "), p.createdByName, p.createdAt.toISOString()]),
      );
    }
    case "customers":
    case "suppliers": {
      if (!need(kind === "customers" ? "receivables.view" : "payables.view")) return null;
      const rows = await counterpartyBalances(ctx, kind === "customers" ? "receivable" : "payable");
      const details = await withTenant(ctx.businessId, (tx) => tx.counterparty.findMany({ where: kind === "customers" ? { isCustomer: true } : { isSupplier: true } }));
      return done(
        ["Name", "Account code", "Contact person", "Phone", "Email", "GSTIN", "Credit days", "Payment terms", "Credit limit", "Status", "Outstanding", "Overdue", "Open invoices"],
        rows.map((r) => {
          const d = details.find((x) => x.id === r.id)!;
          return [r.name, d.accountCode ?? "", d.contactPerson ?? "", d.phone ?? "", d.email ?? "", d.gstin ?? "", (kind === "customers" ? d.customerCreditDays : d.supplierCreditDays) ?? "", d.paymentTerms ?? "", money(r.creditLimit), r.status, money(r.open), money(r.overdue), r.openInvoices];
        }),
      );
    }
    case "followups": {
      if (!need("collections.work")) return null;
      const rows = await withTenant(ctx.businessId, (tx) => tx.followUp.findMany({ orderBy: { dueDate: "desc" }, include: { counterparty: { select: { name: true } }, invoice: { select: { invoiceNumber: true } } } }));
      return done(["Due date", "Title", "Type", "Status", "Account", "Invoice", "Source", "Completed at", "Note"], rows.map((f) => [fromDbDate(f.dueDate), f.title, f.type, f.status, f.counterparty.name, f.invoice?.invoiceNumber ?? "", f.source, f.completedAt?.toISOString() ?? "", f.completionNote ?? ""]));
    }
    case "promises": {
      if (!need("receivables.view")) return null;
      const rows = await withTenant(ctx.businessId, (tx) => tx.paymentPromise.findMany({ orderBy: { promisedDate: "desc" }, include: { counterparty: { select: { name: true } }, invoices: { include: { invoice: { select: { invoiceNumber: true } } } } } }));
      return done(["Customer", "Promised date", "Amount", "Received by date", "Status", "Invoices", "Reason", "Recorded at"], rows.map((p) => [p.counterparty.name, fromDbDate(p.promisedDate), p.amount.toFixed(2), p.amountReceived?.toFixed(2) ?? "", p.status, p.invoices.map((i) => i.invoice.invoiceNumber).join("; "), p.reason ?? "", p.recordedAt.toISOString()]));
    }
    case "disputes": {
      if (!need("collections.work")) return null;
      const rows = await withTenant(ctx.businessId, (tx) => tx.dispute.findMany({ orderBy: { raisedOn: "desc" }, include: { counterparty: { select: { name: true } }, invoice: { select: { invoiceNumber: true, direction: true } } } }));
      return done(["Raised on", "Account", "Invoice", "Direction", "Category", "Status", "Disputed amount", "Hold", "Description", "Resolution"], rows.filter((d) => need(d.invoice.direction === "receivable" ? "receivables.view" : "payables.view")).map((d) => [fromDbDate(d.raisedOn), d.counterparty.name, d.invoice.invoiceNumber, d.invoice.direction, d.category, d.status, d.disputedAmount?.toFixed(2) ?? "", d.collectionHold ? "yes" : "no", d.description, d.resolutionNotes ?? ""]));
    }
    case "report-receivables-ageing":
    case "report-payables-ageing": {
      const direction = kind.includes("receivables") ? "receivable" : "payable";
      if (!need("reports.view", direction === "receivable" ? "receivables.view" : "payables.view")) return null;
      const asOf = isISODate(sp.asOf) ? sp.asOf : ctx.today;
      const r = await ageingReport(ctx, direction, asOf);
      // Fill bucket columns per invoice.
      const filled = r.groups.flatMap((g) => g.invoices.map((i) => {
        const days = Math.round((Date.parse(asOf) - Date.parse(i.dueDate)) / 86400000);
        const key = days < 0 ? "not_due" : days === 0 ? "due_today" : days <= 30 ? "d1_30" : days <= 60 ? "d31_60" : days <= 90 ? "d61_90" : "d90_plus";
        return [g.name, i.invoiceNumber, i.dueDate, ...AGEING_BUCKETS.map((b) => (b.key === key ? money(i.balance) : "")), money(i.balance)];
      }));
      return done(["Account", "Invoice", "Due date", ...AGEING_BUCKETS.map((b) => b.label), `Balance as of ${asOf}`], filled);
    }
    case "report-customer-outstanding":
    case "report-supplier-obligations": {
      const direction = kind.includes("customer") ? "receivable" : "payable";
      if (!need("reports.view", direction === "receivable" ? "receivables.view" : "payables.view")) return null;
      const rows = await counterpartyBalances(ctx, direction);
      return done(
        ["Account", "Open", "Overdue", "Current", "Due in 7 days", "Planned payments", "Oldest invoice", "Oldest due date", "Avg payment delay (days)", "Settled invoices in average", "Last payment date", "Broken promises (window)", "Open disputes", "Disputed amount"],
        rows.filter((r) => r.open > 0n || r.disputes > 0).map((r) => [r.name, money(r.open), money(r.overdue), money(r.current), money(r.due7), money(r.planned), r.oldest?.invoiceNumber ?? "", r.oldest?.dueDate ?? "", r.avgDelay?.avg ?? "insufficient data", r.avgDelay?.n ?? "", r.lastPayment?.date ?? "", r.brokenPromises, r.disputes, money(r.disputedAmount)]),
      );
    }
    case "report-productivity": {
      if (!need("reports.view")) return null;
      const period = resolvePeriod(ctx.today, sp.period, sp.from, sp.to);
      const p = await followUpProductivity(ctx, period);
      return done(["Employee", "Role", "Due", "Completed on time", "Completed late", "Missed", "Upcoming", "Escalations", "Contacts logged", "Period"], p.rows.map((r) => [r.name, r.role, r.due, r.completedOnTime, r.completedLate, r.missed, r.pending, r.escalated, r.communications, period.label]));
    }
  }
  return undefined;
}
