import { describe, it, expect, afterAll } from "vitest";
import { prisma, withTenant } from "@/server/db";
import { createCounterparty } from "@/server/services/counterparties";
import { createInvoice, updateInvoice } from "@/server/services/invoices";
import { recordPayment } from "@/server/services/payments";
import { createPromise, logCommunication, createDispute, updateDispute } from "@/server/services/collections";
import { inviteMember, updateMember } from "@/server/services/business";
import { uploadDocument } from "@/server/services/documents";
import { signDocumentUrl, verifyDocumentSignature } from "@/server/storage";
import { addDays } from "@/domain/dates";
import { ctxFor, hasDb, makeUser, setup } from "./helpers";

const d = describe.skipIf(!hasDb);
afterAll(() => prisma.$disconnect());

d("input validation", () => {
  it("rejects malformed invoice input with field errors and saves nothing", async () => {
    const { ctx } = await setup();
    const cp = await createCounterparty(ctx, { name: "Validation Co", isCustomer: "on" });
    const bad = [
      { counterpartyId: cp.id, invoiceNumber: "", invoiceDate: ctx.today, totalAmount: "10" },
      { counterpartyId: cp.id, invoiceNumber: "V-1", invoiceDate: "2026-02-30", totalAmount: "10" },
      { counterpartyId: cp.id, invoiceNumber: "V-1", invoiceDate: ctx.today, totalAmount: "-5" },
      { counterpartyId: cp.id, invoiceNumber: "V-1", invoiceDate: ctx.today, totalAmount: "10.123" },
      { counterpartyId: cp.id, invoiceNumber: "V-1", invoiceDate: ctx.today, totalAmount: "118", subtotalAmount: "100", taxAmount: "19" },
      { counterpartyId: cp.id, invoiceNumber: "V-1", invoiceDate: ctx.today, totalAmount: "10", dueDateMode: "manual", dueDate: addDays(ctx.today, -1) },
      { counterpartyId: "not-a-uuid", invoiceNumber: "V-1", invoiceDate: ctx.today, totalAmount: "10" },
      { counterpartyId: cp.id, invoiceNumber: "V-1", invoiceDate: ctx.today, totalAmount: "10", creditDays: "400" },
    ];
    for (const b of bad) await expect(createInvoice(ctx, "receivable", b as never)).rejects.toThrow();
    expect(await withTenant(ctx.businessId, (tx) => tx.invoice.count())).toBe(0);
  });

  it("rejects future-dated payments, unknown methods and editing total below paid", async () => {
    const { ctx } = await setup();
    const cp = await createCounterparty(ctx, { name: "Pay Co", isCustomer: "on" });
    const inv = await createInvoice(ctx, "receivable", { counterpartyId: cp.id, invoiceNumber: "P-1", invoiceDate: ctx.today, totalAmount: "100" });
    await expect(recordPayment(ctx, { direction: "received", counterpartyId: cp.id, amount: "10", paymentDate: addDays(ctx.today, 1), method: "UPI" })).rejects.toThrow(/future/);
    await expect(recordPayment(ctx, { direction: "received", counterpartyId: cp.id, amount: "10", paymentDate: ctx.today, method: "Barter" })).rejects.toThrow(/payment methods/);
    await recordPayment(ctx, { direction: "received", counterpartyId: cp.id, amount: "60", paymentDate: ctx.today, method: "UPI", allocations: [{ invoiceId: inv.id, amount: "60" }] });
    await expect(updateInvoice(ctx, inv.id, { invoiceNumber: "P-1", invoiceDate: ctx.today, dueDate: addDays(ctx.today, 30), totalAmount: "50" })).rejects.toThrow(/already paid/);
    await expect(updateInvoice(ctx, inv.id, { invoiceNumber: "P-1", invoiceDate: ctx.today, dueDate: addDays(ctx.today, 10), totalAmount: "100" })).rejects.toThrow(/reason/);
  });

  it("requires notes for outcomes that need context, and promise amounts within the balance", async () => {
    const { ctx } = await setup();
    const cp = await createCounterparty(ctx, { name: "Call Co", isCustomer: "on" });
    const inv = await createInvoice(ctx, "receivable", { counterpartyId: cp.id, invoiceNumber: "C-1", invoiceDate: ctx.today, totalAmount: "1000" });
    await expect(logCommunication(ctx, { counterpartyId: cp.id, channel: "call", outcome: "refused" })).rejects.toThrow();
    await expect(logCommunication(ctx, { counterpartyId: cp.id, channel: "call" })).rejects.toThrow();
    await expect(createPromise(ctx, { counterpartyId: cp.id, invoiceIds: [inv.id], amount: "5000", promisedDate: addDays(ctx.today, 2) })).rejects.toThrow(/exceeds/);
    await expect(createPromise(ctx, { counterpartyId: cp.id, invoiceIds: [inv.id], amount: "500", promisedDate: addDays(ctx.today, -2) })).rejects.toThrow(/past/);
  });

  it("disputes keep the invoice overdue and need a resolution note to close", async () => {
    const { ctx } = await setup();
    const cp = await createCounterparty(ctx, { name: "Dispute Co", isCustomer: "on" });
    const inv = await createInvoice(ctx, "receivable", { counterpartyId: cp.id, invoiceNumber: "D-1", invoiceDate: addDays(ctx.today, -40), dueDateMode: "manual", dueDate: addDays(ctx.today, -10), totalAmount: "1000" });
    const disp = await createDispute(ctx, { invoiceId: inv.id, category: "quantity_mismatch", description: "Short by 2 drums" });
    const i = await withTenant(ctx.businessId, (tx) => tx.invoice.findUniqueOrThrow({ where: { id: inv.id } }));
    expect(i.outstandingAmount.toFixed(2)).toBe("1000.00"); // no automatic waiver
    await expect(updateDispute(ctx, disp.id, { status: "resolved" })).rejects.toThrow(/resolved/);
    await expect(createDispute(ctx, { invoiceId: inv.id, category: "other", description: "x", collectionHold: "on" })).rejects.toThrow();
    await updateDispute(ctx, disp.id, { status: "resolved", resolutionNotes: "Weighbridge slip confirmed full delivery" });
  });
});

d("authorization", () => {
  it("finance managers cannot invite or promote; staff cannot escalate themselves", async () => {
    const { business, ctx: owner } = await setup();
    const fmUser = await makeUser(business.id, "finance_manager");
    const fm = ctxFor(business, fmUser, "finance_manager");
    await expect(inviteMember(fm, { email: "x@example.test", role: "staff" })).rejects.toThrow(/permission/);
    const staffUser = await makeUser(business.id, "staff", ["receivables.view"]);
    const staff = ctxFor(business, staffUser, "staff", ["receivables.view"]);
    const m = await withTenant(business.id, (tx) => tx.membership.findFirstOrThrow({ where: { userId: staffUser.id } }));
    await expect(updateMember(staff, m.id, { role: "owner", permissions: [], status: "active" })).rejects.toThrow(/permission/);
    // The last owner cannot be demoted.
    const ownerM = await withTenant(business.id, (tx) => tx.membership.findFirstOrThrow({ where: { userId: owner.userId } }));
    await expect(updateMember(owner, ownerM.id, { role: "staff", permissions: [], status: "active" })).rejects.toThrow(/at least one active owner/);
    // Staff grants never include admin permissions.
    await updateMember(owner, m.id, { role: "staff", permissions: ["members.manage", "settings.manage", "reports.view"], status: "active" });
    const after = await withTenant(business.id, (tx) => tx.membership.findUniqueOrThrow({ where: { id: m.id } }));
    expect(after.permissions).toEqual(["reports.view"]);
  });

  it("documents: content-sniffed, tenant-scoped, signed links bound to the user", async () => {
    const a = await setup();
    const b = await setup();
    const cpA = await createCounterparty(a.ctx, { name: "Doc Co", isCustomer: "on" });
    const invA = await createInvoice(a.ctx, "receivable", { counterpartyId: cpA.id, invoiceNumber: "DOC-1", invoiceDate: a.ctx.today, totalAmount: "10" });
    const pdf = new File([Buffer.from("%PDF-1.4\n% test\n")], "inv.pdf", { type: "application/pdf" });
    const fake = new File([Buffer.from("<script>alert(1)</script>")], "evil.pdf", { type: "application/pdf" });
    await expect(uploadDocument(a.ctx, fake, { kind: "invoice", invoiceId: invA.id })).rejects.toThrow(/Only PDF/);
    const doc = await uploadDocument(a.ctx, pdf, { kind: "invoice", invoiceId: invA.id });
    expect(doc.storageKey.startsWith(a.ctx.businessId + "/")).toBe(true);
    // Business B cannot attach to A's invoice or see A's document.
    await expect(uploadDocument(b.ctx, pdf, { kind: "invoice", invoiceId: invA.id })).rejects.toThrow(/not found/i);
    expect(await withTenant(b.ctx.businessId, (tx) => tx.document.findFirst({ where: { id: doc.id } }))).toBeNull();
    const url = new URL("http://x" + signDocumentUrl(doc.id, a.ctx.userId));
    expect(verifyDocumentSignature(doc.id, a.ctx.userId, url.searchParams.get("exp"), url.searchParams.get("sig"))).toBe(true);
    expect(verifyDocumentSignature(doc.id, b.ctx.userId, url.searchParams.get("exp"), url.searchParams.get("sig"))).toBe(false);
    expect(verifyDocumentSignature(doc.id, a.ctx.userId, "1", url.searchParams.get("sig"))).toBe(false);
  });

  it("the audit log cannot be altered, even by the app role", async () => {
    const { ctx } = await setup();
    await createCounterparty(ctx, { name: "Audit Co", isCustomer: "on" });
    const row = await withTenant(ctx.businessId, (tx) => tx.auditLog.findFirstOrThrow({}));
    await expect(withTenant(ctx.businessId, (tx) => tx.auditLog.update({ where: { id: row.id }, data: { summary: "tampered" } }))).rejects.toThrow();
    await expect(withTenant(ctx.businessId, (tx) => tx.auditLog.delete({ where: { id: row.id } }))).rejects.toThrow();
  });
});
