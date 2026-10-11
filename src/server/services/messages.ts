import "server-only";
import { withTenant } from "../db";
import { assertCan, type TenantContext } from "../context";
import { AppError, NotFoundError } from "../errors";
import { audit } from "../audit";
import { getEmailProvider } from "../email";
import { paise } from "./common";
import { formatINR } from "@/domain/money";
import { formatDate, fromDbDate } from "@/domain/dates";

export const TEMPLATES = [
  { key: "upcoming", label: "Upcoming payment reminder", audience: "customer" },
  { key: "due_today", label: "Payment due today", audience: "customer" },
  { key: "overdue", label: "Overdue payment follow-up", audience: "customer" },
  { key: "promise_confirm", label: "Confirmation of promised payment", audience: "customer" },
  { key: "promise_broken", label: "Follow-up on missed promised payment", audience: "customer" },
  { key: "remittance", label: "Request for remittance details", audience: "customer" },
  { key: "discrepancy", label: "Clarify an invoice discrepancy", audience: "both" },
  { key: "supplier_schedule", label: "Supplier payment scheduling", audience: "supplier" },
] as const;

export type TemplateKey = (typeof TEMPLATES)[number]["key"];

/**
 * Neutral, factual templates. Only recorded facts are inserted; nothing is
 * invented. The employee reviews and edits before anything is sent.
 */
export async function renderTemplate(ctx: TenantContext, key: string, counterpartyId: string, invoiceId?: string | null) {
  const t = TEMPLATES.find((x) => x.key === key);
  if (!t) throw new AppError("Unknown template");
  return withTenant(ctx.businessId, async (tx) => {
    const cp = await tx.counterparty.findUnique({ where: { id: counterpartyId } });
    if (!cp) throw new NotFoundError("Account");
    const business = await tx.business.findUniqueOrThrow({ where: { id: ctx.businessId } });
    const inv = invoiceId ? await tx.invoice.findFirst({ where: { id: invoiceId, counterpartyId } }) : null;
    const promise = await tx.paymentPromise.findFirst({ where: { counterpartyId, status: { in: ["upcoming", "broken"] } }, orderBy: { promisedDate: "desc" } });
    const planned = inv ? await tx.plannedPayment.findFirst({ where: { invoiceId: inv.id, status: "scheduled" }, orderBy: { plannedDate: "asc" } }) : null;
    const name = cp.contactPerson ?? cp.name;
    const ref = inv ? `invoice ${inv.invoiceNumber} dated ${formatDate(inv.invoiceDate)}` : "your account";
    const amt = inv ? formatINR(paise(inv.outstandingAmount)) : null;
    const due = inv ? formatDate(fromDbDate(inv.dueDate)) : null;
    const sign = `\n\nRegards,\n${ctx.userName}\n${business.name}${business.contactPhone ? `\n${business.contactPhone}` : ""}`;
    const bodies: Record<TemplateKey, { subject: string; body: string }> = {
      upcoming: { subject: `Payment reminder: ${ref}`, body: `Dear ${name},\n\nThis is a reminder that ${amt ?? "the balance"} on ${ref} is due on ${due ?? "the due date"}. Please let us know if you need a copy of the invoice or delivery documents.` },
      due_today: { subject: `Payment due today: ${ref}`, body: `Dear ${name},\n\n${amt ?? "The balance"} on ${ref} is due today (${due ?? ""}). If the payment has already been made, please share the transaction reference so we can update our records.` },
      overdue: { subject: `Overdue payment: ${ref}`, body: `Dear ${name},\n\nOur records show ${amt ?? "a balance"} outstanding on ${ref}, which was due on ${due ?? "the due date"}. Could you please confirm when we can expect payment? If there is any issue with the invoice or delivery, let us know so we can resolve it.` },
      promise_confirm: { subject: `Confirming your payment commitment`, body: `Dear ${name},\n\nThank you for speaking with us. As discussed, we have noted a payment of ${promise ? formatINR(paise(promise.amount)) : "[amount]"} by ${promise ? formatDate(promise.promisedDate) : "[date]"}${inv ? ` against ${ref}` : ""}. Please share the transaction reference once paid.` },
      promise_broken: { subject: `Follow-up on promised payment`, body: `Dear ${name},\n\nWe had noted a payment of ${promise ? formatINR(paise(promise.amount)) : "[amount]"} by ${promise ? formatDate(promise.promisedDate) : "[date]"}, but we have not yet recorded it. If it has been sent, please share the reference; otherwise, please let us know a revised date.` },
      remittance: { subject: `Request for remittance details`, body: `Dear ${name},\n\nWe have received a payment from you but need the remittance details (invoice numbers covered and transaction reference) to allocate it correctly. Could you please share them?` },
      discrepancy: { subject: `Clarification needed: ${ref}`, body: `Dear ${name},\n\nWe would like to clarify a point regarding ${ref}. [Describe the quantity / rate / tax / delivery point here.] Please share any supporting documents you have so we can resolve this quickly.` },
      supplier_schedule: { subject: `Payment schedule: ${inv ? `bill ${inv.invoiceNumber}` : "your account"}`, body: `Dear ${name},\n\n${planned ? `We have scheduled a payment of ${formatINR(paise(planned.amount))} on ${formatDate(planned.plannedDate)}` : "We are scheduling payment"}${inv ? ` towards bill ${inv.invoiceNumber} (balance ${amt})` : ""}. We will share the transaction reference once the payment is made.` },
    };
    const r = bodies[t.key];
    return { subject: r.subject, body: r.body + sign, recipient: cp.email, phone: cp.phone, emailConfigured: getEmailProvider() !== null };
  });
}

/** Records the message. Sends by email only when a provider is configured; otherwise it is stored as prepared (copied). */
export async function sendOrRecordMessage(ctx: TenantContext, input: { counterpartyId: string; invoiceId?: string | null; templateKey: string; channel: "email" | "copy"; recipient?: string; subject: string; body: string }) {
  assertCan(ctx, "collections.work");
  if (!input.body || input.body.trim().length < 10) throw new AppError("The message is empty", { body: "Required" });
  if (input.body.length > 10000) throw new AppError("The message is too long", { body: "Too long" });
  let status: "prepared" | "sent" | "failed" = "prepared";
  let error: string | null = null;
  if (input.channel === "email") {
    if (!input.recipient || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.recipient)) throw new AppError("Enter a valid recipient email", { recipient: "Invalid" });
    const provider = getEmailProvider();
    if (!provider) throw new AppError("Email is not configured. Copy the message instead, or configure SMTP in Settings → Integrations.");
    const r = await provider.send({ to: input.recipient, subject: input.subject, text: input.body, replyTo: ctx.userEmail });
    status = r.ok ? "sent" : "failed";
    error = r.ok ? null : r.error;
  }
  await withTenant(ctx.businessId, async (tx) => {
    const cp = await tx.counterparty.findUnique({ where: { id: input.counterpartyId } });
    if (!cp) throw new NotFoundError("Account");
    if (input.invoiceId && !(await tx.invoice.findFirst({ where: { id: input.invoiceId, counterpartyId: cp.id } }))) throw new NotFoundError("Invoice");
    await tx.messageLog.create({
      data: { businessId: ctx.businessId, counterpartyId: cp.id, invoiceId: input.invoiceId || null, templateKey: input.templateKey, channel: input.channel, recipient: input.recipient ?? null, subject: input.subject, body: input.body, status, error, createdById: ctx.userId },
    });
    if (status === "sent") {
      await tx.communication.create({
        data: { businessId: ctx.businessId, counterpartyId: cp.id, channel: "email", direction: "outbound", notes: `Email sent: ${input.subject}`, contactedAt: new Date(), createdById: ctx.userId, invoices: input.invoiceId ? { create: [{ invoiceId: input.invoiceId, businessId: ctx.businessId }] } : undefined },
      });
    }
    await audit(tx, { businessId: ctx.businessId, actorUserId: ctx.userId, action: `message.${status}`, entityType: "counterparty", entityId: cp.id, summary: `Message “${input.subject}” ${status === "sent" ? `emailed to ${input.recipient}` : status === "failed" ? `failed: ${error}` : "prepared for manual sending"}` });
  });
  if (status === "failed") throw new AppError(`Email could not be sent: ${error}. The attempt was recorded.`);
  return status;
}
