import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma, withTenant, withSystem } from "@/server/db";
import { createCounterparty } from "@/server/services/counterparties";
import { createInvoice, updateInvoice, voidInvoice } from "@/server/services/invoices";
import { recordPayment, reversePayment, reallocate, allocatePayment } from "@/server/services/payments";
import { createPromise, logCommunication, schedulePlannedPayment } from "@/server/services/collections";
import { runReminderProcessor } from "@/server/reminders/processor";
import { dashboardMetrics, resolvePeriod, ageingReport } from "@/server/queries/reports";
import { collectionsQueue } from "@/server/queries/collections";
import { listInvoices, getInvoiceDetail } from "@/server/queries/invoices";
import { previewImport, commitImport } from "@/server/services/imports";
import { setEmailProviderForTests, type EmailProvider } from "@/server/email";
import { addDays, fromDbDate } from "@/domain/dates";
import { fromDecimal } from "@/domain/money";
import { ctxFor, hasDb, makeUser, setup } from "./helpers";
import type { TenantContext } from "@/server/context";

const d = describe.skipIf(!hasDb);

async function customer(ctx: TenantContext, name = "Fictional Customer Pvt Ltd") {
  return createCounterparty(ctx, { name, isCustomer: "on", phone: "+91 90000 11111", customerCreditDays: "30" });
}
async function supplier(ctx: TenantContext, name = "Fictional Supplier LLP") {
  return createCounterparty(ctx, { name, isSupplier: "on", supplierCreditDays: "45" });
}
const inv = (ctx: TenantContext, id: string) => withTenant(ctx.businessId, (tx) => tx.invoice.findUniqueOrThrow({ where: { id } }));

afterAll(async () => {
  setEmailProviderForTests(undefined);
  await prisma.$disconnect();
});

d("Scenario 1–4: receivable lifecycle", () => {
  let ctx: TenantContext;
  let cpId: string;
  let invoiceId: string;

  beforeAll(async () => {
    ({ ctx } = await setup());
    cpId = (await customer(ctx)).id;
  });

  it("1. records a ₹50,000 invoice due in 30 days with a reminder schedule", async () => {
    const created = await createInvoice(ctx, "receivable", { counterpartyId: cpId, invoiceNumber: "INV-001", invoiceDate: ctx.today, totalAmount: "50000", creditDays: "30" });
    invoiceId = created.id;
    expect(fromDbDate(created.dueDate)).toBe(addDays(ctx.today, 30));
    expect(fromDecimal(created.outstandingAmount)).toBe(5_000_000n);
    const list = await listInvoices(ctx, "receivable", {});
    expect(list.rows.map((r) => r.id)).toContain(invoiceId);
    const m = await dashboardMetrics(ctx, resolvePeriod(ctx.today, "30d"));
    expect(m.receivables!.outstanding).toBe(5_000_000n);
    const jobs = await withTenant(ctx.businessId, (tx) => tx.reminderJob.findMany({ where: { invoiceId } }));
    expect(jobs.length).toBeGreaterThanOrEqual(6); // -3, -1, 0, 1, 3, 7, 15, 30
    expect(jobs.every((j) => j.status === "pending")).toBe(true);
  });

  it("rejects a duplicate invoice number without an override", async () => {
    await expect(createInvoice(ctx, "receivable", { counterpartyId: cpId, invoiceNumber: "inv-001", invoiceDate: ctx.today, totalAmount: "10" })).rejects.toThrow(/already exists/);
  });

  it("2. a ₹20,000 partial payment leaves ₹30,000 and partially-paid status", async () => {
    const p = await recordPayment(ctx, { direction: "received", counterpartyId: cpId, amount: "20000", paymentDate: ctx.today, method: "UPI", reference: "UTR-1", allocations: [{ invoiceId, amount: "20000" }] });
    const i = await inv(ctx, invoiceId);
    expect(fromDecimal(i.outstandingAmount)).toBe(3_000_000n);
    expect(fromDecimal(i.amountPaid)).toBe(2_000_000n);
    const detail = await getInvoiceDetail(ctx, invoiceId);
    expect(detail.status).toBe("partially_paid");
    expect(detail.inv.allocations.map((a) => a.paymentId)).toContain(p.id);
  });

  it("rejects an allocation larger than the remaining balance", async () => {
    await expect(
      recordPayment(ctx, { direction: "received", counterpartyId: cpId, amount: "40000", paymentDate: ctx.today, method: "UPI", allocations: [{ invoiceId, amount: "40000" }] }),
    ).rejects.toThrow(/exceeds/);
    // nothing was saved
    const payments = await withTenant(ctx.businessId, (tx) => tx.payment.count({ where: { counterpartyId: cpId } }));
    expect(payments).toBe(1);
  });

  it("3. detects overdue after a due-date change and creates a first-contact task", async () => {
    await updateInvoice(ctx, invoiceId, {
      invoiceNumber: "INV-001",
      invoiceDate: addDays(ctx.today, -40),
      dueDate: addDays(ctx.today, -10),
      totalAmount: "50000",
      changeReason: "Customer copy shows 30 days from an earlier invoice date",
    });
    const detail = await getInvoiceDetail(ctx, invoiceId);
    expect(detail.status).toBe("overdue");
    const overdue = await listInvoices(ctx, "receivable", { filter: "overdue" });
    expect(overdue.rows.map((r) => r.id)).toContain(invoiceId);
    const bucket = await listInvoices(ctx, "receivable", { bucket: "d1_30" });
    expect(bucket.rows.map((r) => r.id)).toContain(invoiceId);
    const m = await dashboardMetrics(ctx, resolvePeriod(ctx.today, "30d"));
    expect(m.receivables!.overdue).toBe(3_000_000n);
    const ageing = await ageingReport(ctx, "receivable", ctx.today);
    expect(ageing.totals.d1_30).toBe(3_000_000n);

    const jobs = await withTenant(ctx.businessId, (tx) => tx.reminderJob.findMany({ where: { invoiceId } }));
    expect(jobs.filter((j) => j.statusReason === "Due date changed").length).toBeGreaterThan(0);

    await runReminderProcessor({ businessId: ctx.businessId, emailProvider: null, ignoreQuietHours: true });
    const fu = await withTenant(ctx.businessId, (tx) => tx.followUp.findFirst({ where: { invoiceId, source: "system_overdue", status: "pending" } }));
    expect(fu).not.toBeNull();
    const queue = await collectionsQueue(ctx);
    const row = queue.find((r) => r.counterpartyId === cpId)!;
    expect(row.priority.reasons.some((r) => r.text.includes("Never contacted"))).toBe(true);

    await logCommunication(ctx, { counterpartyId: cpId, invoiceIds: [invoiceId], channel: "call", outcome: "no_answer" });
    const after = await withTenant(ctx.businessId, (tx) => tx.followUp.findUnique({ where: { id: fu!.id } }));
    expect(after!.status).toBe("completed");
  });

  it("4. paying the remaining ₹30,000 settles the invoice and cancels reminders", async () => {
    await recordPayment(ctx, { direction: "received", counterpartyId: cpId, amount: "30000", paymentDate: ctx.today, method: "Cheque", reference: "CHQ-9", allocations: [{ invoiceId, amount: "30000" }] });
    const i = await inv(ctx, invoiceId);
    expect(fromDecimal(i.outstandingAmount)).toBe(0n);
    expect(fromDbDate(i.settledOn!)).toBe(ctx.today);
    const detail = await getInvoiceDetail(ctx, invoiceId);
    expect(detail.status).toBe("paid");
    expect(detail.inv.allocations.length).toBe(2);
    const pending = await withTenant(ctx.businessId, (tx) => tx.reminderJob.count({ where: { invoiceId, status: "pending" } }));
    expect(pending).toBe(0);
    const m = await dashboardMetrics(ctx, resolvePeriod(ctx.today, "30d"));
    expect(m.receivables!.overdue).toBe(0n);
    expect(m.collected).toBe(5_000_000n);
    // overdue history remains traceable: due date before settlement date
    expect(fromDbDate(i.dueDate) < fromDbDate(i.settledOn!)).toBe(true);
  });

  it("payment reversal restores the balance and keeps history", async () => {
    const pay = await withTenant(ctx.businessId, (tx) => tx.payment.findFirstOrThrow({ where: { reference: "CHQ-9" } }));
    await reversePayment(ctx, pay.id, "Cheque bounced");
    const i = await inv(ctx, invoiceId);
    expect(fromDecimal(i.outstandingAmount)).toBe(3_000_000n);
    expect(i.settledOn).toBeNull();
    const allocs = await withTenant(ctx.businessId, (tx) => tx.paymentAllocation.findMany({ where: { invoiceId } }));
    expect(allocs.length).toBe(2);
    expect(allocs.filter((a) => a.status === "reversed").length).toBe(1);
    const reopened = await withTenant(ctx.businessId, (tx) => tx.reminderJob.count({ where: { invoiceId, status: "pending" } }));
    expect(reopened).toBeGreaterThan(0);
    await expect(reversePayment(ctx, pay.id, "again")).rejects.toThrow(/already reversed/);
  });

  it("void is refused while payments are allocated", async () => {
    await expect(voidInvoice(ctx, invoiceId, "Raised in error")).rejects.toThrow(/allocated/);
  });
});

d("Allocation across invoices and reallocation", () => {
  it("one payment settles two invoices; reallocation keeps both records", async () => {
    const { ctx } = await setup();
    const cp = await customer(ctx);
    const a = await createInvoice(ctx, "receivable", { counterpartyId: cp.id, invoiceNumber: "A-1", invoiceDate: ctx.today, totalAmount: "1000" });
    const b = await createInvoice(ctx, "receivable", { counterpartyId: cp.id, invoiceNumber: "A-2", invoiceDate: ctx.today, totalAmount: "500.50" });
    const pay = await recordPayment(ctx, { direction: "received", counterpartyId: cp.id, amount: "2000", paymentDate: ctx.today, method: "UPI", allocations: [{ invoiceId: a.id, amount: "1000" }, { invoiceId: b.id, amount: "400" }] });
    const p = await withTenant(ctx.businessId, (tx) => tx.payment.findUniqueOrThrow({ where: { id: pay.id } }));
    expect(fromDecimal(p.allocatedAmount)).toBe(140_000n);
    await allocatePayment(ctx, pay.id, [{ invoiceId: b.id, amount: "100.50" }]);
    expect(fromDecimal((await inv(ctx, b.id)).outstandingAmount)).toBe(0n);
    await expect(allocatePayment(ctx, pay.id, [{ invoiceId: a.id, amount: "1" }])).rejects.toThrow();

    const alloc = await withTenant(ctx.businessId, (tx) => tx.paymentAllocation.findFirstOrThrow({ where: { invoiceId: a.id, status: "active" } }));
    const c = await createInvoice(ctx, "receivable", { counterpartyId: cp.id, invoiceNumber: "A-3", invoiceDate: ctx.today, totalAmount: "1000" });
    await reallocate(ctx, alloc.id, c.id, "Customer remittance said A-3");
    expect(fromDecimal((await inv(ctx, a.id)).outstandingAmount)).toBe(100_000n);
    expect(fromDecimal((await inv(ctx, c.id)).outstandingAmount)).toBe(0n);
  });

  it("the database itself rejects over-allocation even if the service is bypassed", async () => {
    const { ctx } = await setup();
    const cp = await customer(ctx);
    const a = await createInvoice(ctx, "receivable", { counterpartyId: cp.id, invoiceNumber: "X-1", invoiceDate: ctx.today, totalAmount: "100" });
    const pay = await recordPayment(ctx, { direction: "received", counterpartyId: cp.id, amount: "50", paymentDate: ctx.today, method: "UPI" });
    await expect(
      withTenant(ctx.businessId, (tx) => tx.paymentAllocation.create({ data: { businessId: ctx.businessId, paymentId: pay.id, invoiceId: a.id, amount: "60.00" } })),
    ).rejects.toThrow();
    await expect(withTenant(ctx.businessId, (tx) => tx.payment.delete({ where: { id: pay.id } }))).rejects.toThrow();
  });
});

d("Scenario 5: payables", () => {
  it("₹80,000 bill, ₹30,000 paid, planned payment is not a payment", async () => {
    const { ctx } = await setup();
    const sp = await supplier(ctx);
    const bill = await createInvoice(ctx, "payable", { counterpartyId: sp.id, invoiceNumber: "SB-77", invoiceDate: ctx.today, totalAmount: "80000", priority: "high" });
    expect(fromDbDate(bill.dueDate)).toBe(addDays(ctx.today, 45));
    await schedulePlannedPayment(ctx, { invoiceId: bill.id, plannedDate: addDays(ctx.today, 5), amount: "50000" });
    let b = await inv(ctx, bill.id);
    expect(fromDecimal(b.outstandingAmount)).toBe(8_000_000n); // planning does not pay
    await recordPayment(ctx, { direction: "made", counterpartyId: sp.id, amount: "30000", paymentDate: ctx.today, method: "Bank transfer (NEFT/RTGS/IMPS)", reference: "NEFT-1", allocations: [{ invoiceId: bill.id, amount: "30000" }] });
    b = await inv(ctx, bill.id);
    expect(fromDecimal(b.outstandingAmount)).toBe(5_000_000n);
    const m = await dashboardMetrics(ctx, resolvePeriod(ctx.today, "30d"));
    expect(m.payables!.outstanding).toBe(5_000_000n);
    expect(m.paidOut).toBe(3_000_000n);
    const ageing = await ageingReport(ctx, "payable", ctx.today);
    expect(ageing.totals.total).toBe(5_000_000n);
    await expect(schedulePlannedPayment(ctx, { invoiceId: bill.id, plannedDate: addDays(ctx.today, 6), amount: "10000" })).rejects.toThrow(/exceed/);
    // a payment made to a supplier cannot be allocated to a receivable
    const cust = await customer(ctx, "Other Customer");
    const r = await createInvoice(ctx, "receivable", { counterpartyId: cust.id, invoiceNumber: "R-1", invoiceDate: ctx.today, totalAmount: "100" });
    await expect(recordPayment(ctx, { direction: "made", counterpartyId: sp.id, amount: "100", paymentDate: ctx.today, method: "UPI", allocations: [{ invoiceId: r.id, amount: "100" }] })).rejects.toThrow();
  });
});

d("Scenario 6: promises and escalation", () => {
  it("broken promises are detected from payments, and two trigger an owner review", async () => {
    const { ctx: today, business, user } = await setup();
    const cp = await customer(today);
    const invoice = await createInvoice(today, "receivable", { counterpartyId: cp.id, invoiceNumber: "P-1", invoiceDate: addDays(today.today, -60), dueDate: addDays(today.today, -30), dueDateMode: "manual", totalAmount: "100000" });

    // Promise recorded 10 days ago for 5 days ago (simulate by backdating the context).
    const past = ctxFor(business, user, "owner", [], addDays(today.today, -10));
    const p1 = await createPromise(past, { counterpartyId: cp.id, invoiceIds: [invoice.id], amount: "15000", promisedDate: addDays(today.today, -5) });
    await withSystem((tx) => tx.paymentPromise.update({ where: { id: p1.id }, data: { recordedAt: new Date(Date.now() - 10 * 86_400_000) } }));
    const queueBefore = await collectionsQueue(today);
    expect(queueBefore.find((r) => r.counterpartyId === cp.id)).toBeDefined();

    await runReminderProcessor({ businessId: business.id, emailProvider: null, ignoreQuietHours: true });
    const after1 = await withTenant(business.id, (tx) => tx.paymentPromise.findUniqueOrThrow({ where: { id: p1.id } }));
    expect(after1.status).toBe("broken");
    expect(fromDecimal(after1.amountReceived)).toBe(0n);
    const pays = await withTenant(business.id, (tx) => tx.payment.count({ where: { counterpartyId: cp.id } }));
    expect(pays).toBe(0); // nothing fabricated
    let escalations = await withTenant(business.id, (tx) => tx.followUp.count({ where: { counterpartyId: cp.id, type: "escalation" } }));
    expect(escalations).toBe(0);

    const past2 = ctxFor(business, user, "owner", [], addDays(today.today, -4));
    const p2 = await createPromise(past2, { counterpartyId: cp.id, invoiceIds: [invoice.id], amount: "15000", promisedDate: addDays(today.today, -2) });
    await withSystem((tx) => tx.paymentPromise.update({ where: { id: p2.id }, data: { recordedAt: new Date(Date.now() - 4 * 86_400_000) } }));
    await runReminderProcessor({ businessId: business.id, emailProvider: null, ignoreQuietHours: true });
    escalations = await withTenant(business.id, (tx) => tx.followUp.count({ where: { counterpartyId: cp.id, type: "escalation" } }));
    expect(escalations).toBe(1);
    const notes = await withTenant(business.id, (tx) => tx.notification.findMany({ where: { userId: user.id, category: "promise_repeated_broken" } }));
    expect(notes.length).toBe(1);

    // A later payment dated within the promise window updates the outcome.
    const p3 = await createPromise(today, { counterpartyId: cp.id, invoiceIds: [invoice.id], amount: "15000", promisedDate: addDays(today.today, 3) });
    await recordPayment(today, { direction: "received", counterpartyId: cp.id, amount: "15000", paymentDate: today.today, method: "UPI", allocations: [{ invoiceId: invoice.id, amount: "15000" }] });
    const kept = await withTenant(business.id, (tx) => tx.paymentPromise.findUniqueOrThrow({ where: { id: p3.id } }));
    expect(kept.status).toBe("kept");
  });
});

d("Scenario 7: reminder reliability", () => {
  it("repeat runs create no duplicates; email failures are recorded and retried boundedly", async () => {
    const { ctx, business, user } = await setup();
    const cp = await customer(ctx);
    const due = await createInvoice(ctx, "receivable", { counterpartyId: cp.id, invoiceNumber: "R-7", invoiceDate: addDays(ctx.today, -31), dueDate: addDays(ctx.today, -1), dueDateMode: "manual", totalAmount: "5000", assignedUserId: user.id });
    const paid = await createInvoice(ctx, "receivable", { counterpartyId: cp.id, invoiceNumber: "R-8", invoiceDate: addDays(ctx.today, -31), dueDate: addDays(ctx.today, -1), dueDateMode: "manual", totalAmount: "100", assignedUserId: user.id });
    await recordPayment(ctx, { direction: "received", counterpartyId: cp.id, amount: "100", paymentDate: ctx.today, method: "Cash", allocations: [{ invoiceId: paid.id, amount: "100" }] });

    let calls = 0;
    const failing: EmailProvider = {
      name: "failing",
      async send(msg) {
        // Count only the invoice reminder; the overdue first-contact follow-up sends its own email.
        if (msg.subject.startsWith("[Receivable overdue]")) calls++;
        return { ok: false, error: "ECONNREFUSED: test", transient: true };
      },
    };
    const now = new Date();
    await runReminderProcessor({ businessId: business.id, emailProvider: failing, now, ignoreQuietHours: true });
    await runReminderProcessor({ businessId: business.id, emailProvider: failing, now, ignoreQuietHours: true });

    const notifs = await withTenant(business.id, (tx) => tx.notification.findMany({ where: { userId: user.id, entityId: due.id } }));
    expect(notifs.length).toBe(1); // second run created nothing new
    const paidNotifs = await withTenant(business.id, (tx) => tx.notification.count({ where: { entityId: paid.id } }));
    expect(paidNotifs).toBe(0); // settled invoice excluded
    const job = await withTenant(business.id, (tx) => tx.reminderJob.findFirstOrThrow({ where: { invoiceId: due.id, scheduledFor: new Date(addDays(ctx.today, 0) + "T00:00:00Z") } }).catch(() => tx.reminderJob.findFirstOrThrow({ where: { invoiceId: due.id, status: { in: ["pending", "failed"] } } })));
    const deliveries = await withTenant(business.id, (tx) => tx.reminderDelivery.findMany({ where: { jobId: job.id, channel: "email" } }));
    expect(deliveries[0].status).toBe("failed");
    expect(job.status).toBe("pending"); // retry scheduled, not resent immediately
    expect(calls).toBe(1);

    // Advance time past each backoff: total attempts are bounded.
    for (let i = 1; i <= 5; i++) {
      await runReminderProcessor({ businessId: business.id, emailProvider: failing, now: new Date(now.getTime() + i * 3 * 3600_000), ignoreQuietHours: true });
    }
    const final = await withTenant(business.id, (tx) => tx.reminderJob.findUniqueOrThrow({ where: { id: job.id } }));
    expect(final.status).toBe("failed");
    expect(final.attempts).toBe(3);
    expect(calls).toBe(3);
    const failureNote = await withTenant(business.id, (tx) => tx.notification.count({ where: { userId: user.id, dedupeKey: `delivery_failure:${job.id}` } }));
    expect(failureNote).toBe(1);

    // Due-date change: future reminders move.
    const future = await createInvoice(ctx, "receivable", { counterpartyId: cp.id, invoiceNumber: "R-9", invoiceDate: ctx.today, totalAmount: "100" });
    const oldKeys = (await withTenant(business.id, (tx) => tx.reminderJob.findMany({ where: { invoiceId: future.id, status: "pending" } }))).map((j) => fromDbDate(j.scheduledFor));
    await updateInvoice(ctx, future.id, { invoiceNumber: "R-9", invoiceDate: ctx.today, dueDate: addDays(ctx.today, 60), totalAmount: "100", changeReason: "Extended terms agreed" });
    const newKeys = (await withTenant(business.id, (tx) => tx.reminderJob.findMany({ where: { invoiceId: future.id, status: "pending" } }))).map((j) => fromDbDate(j.scheduledFor));
    expect(newKeys).not.toEqual(oldKeys);
    expect(newKeys).toContain(addDays(ctx.today, 60));

    const runs = await withTenant(business.id, (tx) => tx.auditLog.count({ where: { action: "reminders.run" } }));
    expect(runs).toBeGreaterThanOrEqual(7);
  });

  it("quiet hours defer delivery", async () => {
    const { business } = await setup();
    await withSystem((tx) => tx.businessSettings.update({ where: { businessId: business.id }, data: { workingDays: [1], reminderStartHour: 9, reminderEndHour: 10 } }));
    // Sunday 03:00 IST
    const [res] = await runReminderProcessor({ businessId: business.id, emailProvider: null, now: new Date("2026-10-10T21:30:00Z") });
    expect(res.deferredQuietHours).toBe(true);
  });
});

d("Scenario 8: tenant isolation", () => {
  it("a user in business A cannot read or write business B's records", async () => {
    const a = await setup();
    const b = await setup();
    const cpB = await customer(b.ctx, "B's customer");
    const invB = await createInvoice(b.ctx, "receivable", { counterpartyId: cpB.id, invoiceNumber: "B-1", invoiceDate: b.ctx.today, totalAmount: "999" });

    // Direct object reference through the A context (RLS hides B's rows).
    await expect(getInvoiceDetail(a.ctx, invB.id)).rejects.toThrow(/not found/i);
    const seen = await withTenant(a.ctx.businessId, (tx) => tx.invoice.findMany({}));
    expect(seen.find((i) => i.id === invB.id)).toBeUndefined();
    await expect(recordPayment(a.ctx, { direction: "received", counterpartyId: cpB.id, amount: "1", paymentDate: a.ctx.today, method: "UPI" })).rejects.toThrow(/not found/i);
    // Writing a row that claims B's business id from A's context is rejected by RLS WITH CHECK.
    await expect(withTenant(a.ctx.businessId, (tx) => tx.counterparty.create({ data: { businessId: b.ctx.businessId, name: "Injected", isCustomer: true } }))).rejects.toThrow();
    // Referencing B's counterparty from A's own row is rejected by the same-business trigger.
    const cpA = await customer(a.ctx, "A's customer");
    await expect(
      withTenant(a.ctx.businessId, (tx) => tx.invoice.create({ data: { businessId: a.ctx.businessId, direction: "receivable", counterpartyId: cpB.id, invoiceNumber: "Z", invoiceDate: new Date(), dueDate: new Date(), totalAmount: "1", outstandingAmount: "1" } })),
    ).rejects.toThrow();
    expect(cpA.id).toBeTruthy();
    // Without any tenant context, nothing is visible (fail closed).
    expect(await prisma.invoice.count()).toBe(0);
    // Queries are scoped.
    const listA = await listInvoices(a.ctx, "receivable", { filter: "all" });
    expect(listA.rows.length).toBe(0);
  });

  it("staff without payables permission cannot see payables", async () => {
    const { business, ctx: owner } = await setup();
    const staffUser = await makeUser(business.id, "staff", ["receivables.view", "collections.work"]);
    const staff = ctxFor(business, staffUser, "staff", ["receivables.view", "collections.work"]);
    await expect(listInvoices(staff, "payable", {})).rejects.toThrow(/permission/);
    const cp = await customer(owner);
    await expect(createInvoice(staff, "receivable", { counterpartyId: cp.id, invoiceNumber: "S-1", invoiceDate: staff.today, totalAmount: "1" })).rejects.toThrow(/permission/);
    await expect(recordPayment(staff, { direction: "received", counterpartyId: cp.id, amount: "1", paymentDate: staff.today, method: "UPI" })).rejects.toThrow(/permission/);
  });
});

d("Scenario 9: CSV import", () => {
  it("imports valid rows, reports invalid rows and skips duplicates", async () => {
    const { ctx } = await setup();
    const customers = "name,account_code,phone,credit_days\nAlpha Traders (fictional),C-1,+91 90000 00001,30\nBeta Chem (fictional),C-2,,45\n";
    const r1 = await commitImport(ctx, "customers", customers, "customers.csv", (await previewImport(ctx, "customers", customers, null)).mapping, []);
    expect(r1.created).toBe(2);
    await expect(commitImport(ctx, "customers", customers, "customers.csv", (await previewImport(ctx, "customers", customers, null)).mapping, [])).rejects.toThrow(/already imported/);

    const invoices = [
      "party,invoice_number,invoice_date,due_date,total_amount",
      "C-1,I-100,01/09/2026,01/10/2026,10000",
      "C-2,I-101,2026-09-02,,25000.50",
      "C-1,I-100,01/09/2026,01/10/2026,10000", // duplicate within file
      "C-9,I-102,01/09/2026,,500", // unknown customer
      "C-1,I-103,31/02/2026,,500", // invalid date
      "C-1,I-104,01/09/2026,,abc", // invalid amount
    ].join("\n");
    const preview = await previewImport(ctx, "receivables", invoices, null);
    expect(preview.results.filter((r) => r.errors.length === 0 && !r.duplicate).length).toBe(2);
    expect(preview.results[2].duplicate).toMatch(/Same invoice number/);
    expect(preview.results[3].errors.join()).toMatch(/not found/);
    expect(preview.results[4].errors.join()).toMatch(/not a valid date/);
    expect(preview.results[5].errors.join()).toMatch(/not a valid amount/);
    const res = await commitImport(ctx, "receivables", invoices, "inv.csv", preview.mapping, []);
    expect(res).toMatchObject({ created: 2, skipped: 1, failed: 3, total: 6 });
    const m = await dashboardMetrics(ctx, resolvePeriod(ctx.today, "30d"));
    expect(m.receivables!.outstanding).toBe(3_500_050n);

    const payments = "direction,party,amount,payment_date,method,reference,invoice_number\nreceived,C-1,4000,05/10/2026,UPI,U1,I-100\nreceived,C-1,99999,05/10/2026,UPI,U2,I-100\n";
    const pr = await commitImport(ctx, "payments", payments, "p.csv", (await previewImport(ctx, "payments", payments, null)).mapping, []);
    expect(pr).toMatchObject({ created: 1, failed: 1 });
    const m2 = await dashboardMetrics(ctx, resolvePeriod(ctx.today, "30d"));
    expect(m2.receivables!.outstanding).toBe(3_100_050n);
  });
});
