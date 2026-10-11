/**
 * Demo mode: creates a separate, clearly-labelled fictional business with
 * realistic-looking but generated data. It never touches existing businesses.
 *
 *   npm run db:seed-demo            # creates the demo business (skips if one exists)
 *   npm run db:seed-demo -- --new   # creates an additional demo business
 *
 * All names, phone numbers and emails are fictional (example.* domains,
 * 90000-series numbers). Data is created through the same services the app
 * uses, so every balance and dashboard figure is computed, not hard-coded.
 */
import { randomUUID } from "node:crypto";
import { prisma, withSystem, withTenant } from "../src/server/db";
import { hashPassword } from "../src/server/auth/password";
import { createCounterpartyTx } from "../src/server/services/counterparties";
import { createInvoiceTx } from "../src/server/services/invoices";
import { recordPaymentTx } from "../src/server/services/payments";
import { createDisputeTx, createFollowUpTx } from "../src/server/services/collections";
import { evaluatePromises } from "../src/server/services/promises";
import { runReminderProcessor } from "../src/server/reminders/processor";
import { effectivePermissions } from "../src/domain/permissions";
import { addDays, todayIn, toDbDate } from "../src/domain/dates";

const DEMO_PASSWORD = "Demo-ledgerflow-2026";
const TZ = "Asia/Kolkata";

async function upsertUser(email: string, name: string) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return existing;
  return prisma.user.create({ data: { email, name, passwordHash: await hashPassword(DEMO_PASSWORD) } });
}

async function main() {
  const fresh = process.argv.includes("--new");
  const existing = await prisma.business.findFirst({ where: { isDemo: true }, orderBy: { createdAt: "asc" } });
  if (existing && !fresh) {
    console.log(`Demo business already exists: ${existing.name}. Sign in as demo-owner@ledgerflow.example / ${DEMO_PASSWORD}`);
    console.log("Run with --new to create another demo business.");
    return;
  }
  const today = todayIn(TZ);
  const d = (n: number) => addDays(today, n);

  const owner = await upsertUser("demo-owner@ledgerflow.example", "Anand Rao (demo owner)");
  const fm = await upsertUser("demo-finance@ledgerflow.example", "Meera Iyer (demo finance)");
  const staff = await upsertUser("demo-staff@ledgerflow.example", "Ravi Kumar (demo staff)");

  const suffix = fresh ? ` ${randomUUID().slice(0, 4).toUpperCase()}` : "";
  const business = await withSystem(async (tx) => {
    const b = await tx.business.create({
      data: {
        name: `Deccan Chem Distributors — DEMO${suffix}`,
        legalName: "Deccan Chem Distributors (fictional demo company)",
        businessType: "Chemical distributor",
        address: "Plot 0, Example Industrial Estate, Hyderabad, Telangana (fictional)",
        contactEmail: "accounts@deccanchem.example",
        contactPhone: "+91 90000 00000",
        timezone: TZ,
        defaultCustomerCreditDays: 30,
        defaultSupplierCreditDays: 45,
        isDemo: true,
      },
    });
    await tx.businessSettings.create({ data: { businessId: b.id } });
    await tx.membership.create({ data: { businessId: b.id, userId: owner.id, role: "owner" } });
    await tx.membership.create({ data: { businessId: b.id, userId: fm.id, role: "finance_manager" } });
    await tx.membership.create({ data: { businessId: b.id, userId: staff.id, role: "staff", permissions: ["receivables.view", "collections.work", "documents.manage", "payments.record"] } });
    return b;
  });
  await prisma.session.updateMany({ where: { userId: owner.id }, data: { activeBusinessId: business.id } });

  const ctx = { businessId: business.id, userId: owner.id, permissions: effectivePermissions("owner", []), today, timezone: TZ };

  await withTenant(business.id, async (tx) => {
    // ---------------------------------------------------------------- accounts
    const C = async (name: string, code: string, days: number, extra: Record<string, string> = {}) =>
      createCounterpartyTx(tx, ctx, { name, accountCode: code, isCustomer: "on", customerCreditDays: String(days), phone: `+91 90000 1${code.slice(-4)}`, email: `accounts@${code.toLowerCase()}.example`, contactPerson: extra.contact ?? "Accounts desk", assignedUserId: extra.assign ?? staff.id, paymentTerms: `Net ${days}`, notes: "Fictional demo customer", ...(extra.limit ? { creditLimit: extra.limit } : {}) });
    const S = async (name: string, code: string, days: number) =>
      createCounterpartyTx(tx, ctx, { name, accountCode: code, isSupplier: "on", supplierCreditDays: String(days), phone: `+91 90000 2${code.slice(-4)}`, email: `billing@${code.toLowerCase()}.example`, contactPerson: "Billing team", assignedUserId: fm.id, paymentTerms: `Net ${days}`, notes: "Fictional demo supplier" });

    const godavari = await C("Godavari Polymers Pvt Ltd (demo)", "CUST-0101", 30, { contact: "Mr. Srinivas (fictional)", limit: "800000" });
    const krishna = await C("Krishna Paints & Coatings (demo)", "CUST-0102", 45, { contact: "Ms. Lakshmi (fictional)", limit: "500000" });
    const charminar = await C("Charminar Textiles Processing (demo)", "CUST-0103", 30, { contact: "Mr. Imran (fictional)", limit: "300000" });
    const musi = await C("Musi Valley Pharma Intermediates (demo)", "CUST-0104", 60, { contact: "Dr. Kavitha (fictional)", assign: fm.id });
    const banjara = await C("Banjara Detergents LLP (demo)", "CUST-0105", 30, { contact: "Mr. Prakash (fictional)" });
    const golconda = await C("Golconda Water Treatment Co. (demo)", "CUST-0106", 30, { contact: "Ms. Farah (fictional)" });
    const nizam = await C("Nizam Agro Chemicals (demo)", "CUST-0107", 45, { contact: "Mr. Venkat (fictional)", limit: "250000" });
    const shamshabad = await C("Shamshabad Rubber Works (demo)", "CUST-0108", 30, { contact: "Mr. Arjun (fictional)" });
    const both = await createCounterpartyTx(tx, ctx, { name: "Medchal Solvent Recyclers (demo)", accountCode: "BOTH-0201", isCustomer: "on", isSupplier: "on", customerCreditDays: "30", supplierCreditDays: "30", phone: "+91 90000 30201", contactPerson: "Mr. Rahul (fictional)", assignedUserId: staff.id, notes: "Fictional: buys recovered solvent from us and supplies recycled drums" });

    const reliable = await S("Andhra Caustic Soda Ltd (demo)", "SUP-0301", 45);
    const coastal = await S("Coastal Acids & Alkalis (demo)", "SUP-0302", 30);
    const vizag = await S("Vizag Petrochem Traders (demo)", "SUP-0303", 60);
    const drums = await S("Patancheru Drums & Packaging (demo)", "SUP-0304", 15);
    const transport = await S("Telangana Tanker Logistics (demo)", "SUP-0305", 7);
    await S("Nellore Mineral Salts (demo)", "SUP-0306", 30);

    // ---------------------------------------------------------------- receivables
    const R = async (cp: { id: string }, no: string, invoiceAgo: number, dueIn: number, total: string, extra: Record<string, string> = {}) =>
      createInvoiceTx(tx, ctx, "receivable", { counterpartyId: cp.id, invoiceNumber: no, invoiceDate: d(-invoiceAgo), dueDateMode: "manual", dueDate: d(dueIn), totalAmount: total, taxAmount: extra.tax, subtotalAmount: extra.sub, poReference: extra.po ?? `PO-${no.slice(-3)}`, deliveryReference: extra.dc ?? `DC-${no.slice(-3)}`, notes: extra.notes });
    const pay = async (cp: { id: string }, amount: string, ago: number, method: string, ref: string, allocations: { invoiceId: string; amount: string }[], direction: "received" | "made" = "received") =>
      recordPaymentTx(tx, ctx, { direction, counterpartyId: cp.id, amount, paymentDate: d(-ago), method, reference: ref, allocations });

    // Settled history (for payment-behaviour averages).
    for (const [cp, base, delays] of [[godavari, 1000, [5, 12, 18, 9]], [krishna, 2000, [-2, 0, 3]], [banjara, 3000, [20, 26, 31]], [golconda, 4000, [0, 1, -1]]] as const) {
      let k = 0;
      for (const delay of delays) {
        k++;
        const age = 150 - k * 20;
        const inv = await R(cp, `HIST-${base + k}`, age, -(age - 30), `${118000 + k * 7500}.00`, { tax: `${18000 + k * 1144}.00`, sub: `${100000 + k * 6356}.00` });
        await pay(cp, `${118000 + k * 7500}.00`, age - 30 - delay, k % 2 ? "Bank transfer (NEFT/RTGS/IMPS)" : "UPI", `UTR${base + k}0099`, [{ invoiceId: inv.id, amount: `${118000 + k * 7500}.00` }]);
      }
    }

    // Open receivables across ageing buckets.
    const g1 = await R(godavari, "INV-2401", 75, -45, "354000.00", { tax: "54000.00", sub: "300000.00", notes: "Caustic soda flakes, 12 MT" });
    const g2 = await R(godavari, "INV-2416", 40, -10, "212400.00", { tax: "32400.00", sub: "180000.00" });
    const g3 = await R(godavari, "INV-2433", 10, 20, "141600.00");
    const k1 = await R(krishna, "INV-2405", 60, -15, "236000.00");
    const k2 = await R(krishna, "INV-2429", 20, 0, "94400.00", { notes: "Due today" });
    const c1 = await R(charminar, "INV-2398", 125, -95, "188800.00", { notes: "Sodium hydrosulphite" });
    const c2 = await R(charminar, "INV-2412", 70, -40, "70800.00");
    const m1 = await R(musi, "INV-2408", 70, -10, "472000.00");
    const m2 = await R(musi, "INV-2431", 15, 45, "295000.00");
    const b1 = await R(banjara, "INV-2419", 36, -6, "165200.00");
    const b2 = await R(banjara, "INV-2436", 5, 25, "59000.00");
    const o1 = await R(golconda, "INV-2425", 29, 1, "106200.00");
    const o2 = await R(golconda, "INV-2437", 3, 3, "47200.00");
    const n1 = await R(nizam, "INV-2402", 110, -65, "129800.00", { notes: "Customer reports short delivery" });
    const n2 = await R(nizam, "INV-2420", 50, -5, "82600.00");
    const s1 = await R(shamshabad, "INV-2427", 31, -1, "35400.00");
    const s2 = await R(shamshabad, "INV-2434", 8, 22, "28320.00");
    const x1 = await R(both, "INV-2423", 45, -15, "61360.00");
    void [g3, m2, b2, o2, s2];

    // Payments: partial, multi-invoice, unallocated, reversed.
    await pay(godavari, "100000.00", 20, "Bank transfer (NEFT/RTGS/IMPS)", "UTR77104411", [{ invoiceId: g1.id, amount: "100000.00" }]);
    await pay(krishna, "136000.00", 8, "Cheque", "CHQ 004512", [{ invoiceId: k1.id, amount: "136000.00" }]);
    await pay(musi, "200000.00", 4, "Bank transfer (NEFT/RTGS/IMPS)", "UTR88120931", [{ invoiceId: m1.id, amount: "200000.00" }]);
    await pay(charminar, "70800.00", 12, "UPI", "UPI 4021-77", [{ invoiceId: c2.id, amount: "50000.00" }]); // 20,800 left unallocated (remittance unclear)
    await pay(golconda, "106200.00", 1, "UPI", "UPI 4021-88", [{ invoiceId: o1.id, amount: "106200.00" }]);
    const bounced = await pay(banjara, "165200.00", 3, "Cheque", "CHQ 118802", [{ invoiceId: b1.id, amount: "165200.00" }]);
    await tx.paymentAllocation.updateMany({ where: { paymentId: bounced.id }, data: { status: "reversed", reversedAt: new Date(), reversedById: owner.id, reversalReason: "Payment reversed: cheque returned unpaid (fictional)" } });
    await tx.payment.update({ where: { id: bounced.id }, data: { status: "reversed", reversedAt: new Date(), reversedById: owner.id, reversalReason: "Cheque returned unpaid (fictional)" } });

    // ---------------------------------------------------------------- communications & promises
    const comm = async (cp: { id: string }, invIds: string[], ago: number, outcome: string, notes: string, by = staff.id) =>
      tx.communication.create({ data: { businessId: business.id, counterpartyId: cp.id, channel: "call", outcome: outcome as never, notes, contactedAt: new Date(Date.parse(d(-ago) + "T06:00:00Z")), createdById: by, invoices: { create: invIds.map((i) => ({ invoiceId: i, businessId: business.id })) } } });
    const promise = async (cp: { id: string }, invIds: string[], amount: string, recordedAgo: number, promisedIn: number, reason: string) =>
      tx.paymentPromise.create({ data: { businessId: business.id, counterpartyId: cp.id, amount, promisedDate: toDbDate(d(promisedIn)), reason, recordedAt: new Date(Date.parse(d(-recordedAgo) + "T06:30:00Z")), createdById: staff.id, followUpDate: toDbDate(d(promisedIn)), invoices: { create: invIds.map((i) => ({ invoiceId: i, businessId: business.id })) } } });

    // Charminar: two broken promises → owner escalation when the processor runs.
    await comm(charminar, [c1.id], 40, "payment_promised", "Said payment from their buyer is delayed; promised part payment.");
    await promise(charminar, [c1.id], "75000.00", 40, -30, "Waiting for their buyer's payment");
    await comm(charminar, [c1.id], 20, "payment_promised", "Missed earlier date. New commitment for 75,000.");
    await promise(charminar, [c1.id], "75000.00", 20, -7, "Second commitment after missed date");
    // Godavari: upcoming promise; Krishna: promise due today; Musi: kept promise.
    await comm(godavari, [g1.id, g2.id], 3, "payment_promised", "Accounts head confirmed RTGS next week for INV-2401 balance.", fm.id);
    await promise(godavari, [g1.id], "254000.00", 3, 4, "Month-end collections from their customers");
    await comm(krishna, [k1.id], 9, "part_payment_received", "Cheque collected for 1,36,000; balance promised today.");
    await promise(krishna, [k1.id], "100000.00", 9, 0, "Balance after part payment");
    await promise(musi, [m1.id], "200000.00", 10, -4, "Partial against INV-2408");
    // Nizam: dispute on short delivery. Banjara: bounced cheque, never re-contacted.
    await comm(nizam, [n1.id], 30, "delivery_dispute", "Claims 400 kg short on DC-401. Asked for weighbridge slip.");
    await createDisputeTx(tx, ctx, { invoiceId: n1.id, category: "quantity_mismatch", description: "Customer reports 400 kg short against DC-401. Weighbridge slip requested from transporter (fictional).", disputedAmount: "11800.00" });
    await tx.dispute.updateMany({ where: { invoiceId: n1.id }, data: { lastActivityAt: new Date(Date.now() - 12 * 86_400_000), raisedOn: toDbDate(d(-30)) } });
    await comm(both, [x1.id], 16, "extension_requested", "Asked for 15 more days; offered to net against our drum purchases. Not agreed.");

    // Follow-ups: one missed, one today, completed history.
    await createFollowUpTx(tx, ctx, { counterpartyId: both.id, invoiceId: x1.id, type: "call", title: "Call Medchal about INV-2423 extension request", dueDate: today, assignedUserId: staff.id });
    const missed = await createFollowUpTx(tx, ctx, { counterpartyId: krishna.id, invoiceId: k1.id, type: "call", title: "Collect remaining balance on INV-2405", dueDate: today, assignedUserId: staff.id });
    await tx.followUp.update({ where: { id: missed.id }, data: { dueDate: toDbDate(d(-2)) } });
    const done = await createFollowUpTx(tx, ctx, { counterpartyId: musi.id, invoiceId: m1.id, type: "call", title: "Confirm RTGS for INV-2408", dueDate: today, assignedUserId: fm.id });
    await tx.followUp.update({ where: { id: done.id }, data: { dueDate: toDbDate(d(-5)), status: "completed", completedAt: new Date(Date.now() - 5 * 86_400_000), completedById: fm.id, completionNote: "Confirmed; partial RTGS sent" } });

    // ---------------------------------------------------------------- payables
    const P = async (cp: { id: string }, no: string, billAgo: number, dueIn: number, total: string, priority = "normal") =>
      createInvoiceTx(tx, ctx, "payable", { counterpartyId: cp.id, invoiceNumber: no, invoiceDate: d(-billAgo), dueDateMode: "manual", dueDate: d(dueIn), totalAmount: total, priority: priority as never, poReference: `OUR-PO-${no.slice(-3)}`, deliveryReference: `GRN-${no.slice(-3)}` });
    const p1 = await P(reliable, "ACS/24-25/0871", 50, -5, "590000.00", "critical");
    const p2 = await P(reliable, "ACS/24-25/0902", 20, 25, "413000.00", "high");
    const p3 = await P(coastal, "CAA-1187", 28, 2, "177000.00", "high");
    const p4 = await P(vizag, "VPT/7731", 40, 20, "826000.00");
    const p5 = await P(drums, "PDP-3302", 18, -3, "64900.00");
    const p6 = await P(transport, "TTL-0451", 9, -2, "38940.00", "low");
    const p7 = await P(transport, "TTL-0466", 3, 4, "21240.00", "low");
    const p8 = await P(both, "MSR-118", 12, 18, "33040.00");
    await pay(reliable, "300000.00", 6, "Bank transfer (NEFT/RTGS/IMPS)", "OUT-UTR5521", [{ invoiceId: p1.id, amount: "300000.00" }], "made");
    await pay(drums, "30000.00", 2, "UPI", "OUT-UPI-772", [{ invoiceId: p5.id, amount: "30000.00" }], "made");
    await tx.plannedPayment.create({ data: { businessId: business.id, invoiceId: p1.id, plannedDate: toDbDate(d(2)), amount: "290000.00", promisedToSupplier: true, notes: "Committed to supplier on call (fictional)", createdById: fm.id } });
    await tx.plannedPayment.create({ data: { businessId: business.id, invoiceId: p3.id, plannedDate: toDbDate(d(2)), amount: "177000.00", createdById: fm.id } });
    await tx.plannedPayment.create({ data: { businessId: business.id, invoiceId: p4.id, plannedDate: toDbDate(d(18)), amount: "400000.00", createdById: fm.id } });
    await createDisputeTx(tx, ctx, { invoiceId: p6.id, category: "rate_mismatch", description: "Tanker charged at ₹62/km vs agreed ₹55/km (fictional).", disputedAmount: "4200.00" });
    void [p2, p7, p8];

    await evaluatePromises(tx, { businessId: business.id, timezone: TZ, today, actorUserId: null });
  });

  // Generate reminders, first-contact tasks, broken-promise follow-ups, escalations and notifications.
  const [summary] = await runReminderProcessor({ businessId: business.id, ignoreQuietHours: true, emailProvider: null });
  console.log("Reminder run:", summary);
  console.log(`\nDemo business created: ${business.name}`);
  console.log("Sign in with any of (password for all: " + DEMO_PASSWORD + "):");
  console.log("  demo-owner@ledgerflow.example    (Owner / Admin)");
  console.log("  demo-finance@ledgerflow.example  (Finance Manager)");
  console.log("  demo-staff@ledgerflow.example    (Staff: receivables, collections, payments)");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
