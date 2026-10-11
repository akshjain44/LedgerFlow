import "server-only";
import { z } from "zod";
import type { CallOutcome, DisputeStatus } from "@prisma/client";
import { withTenant, type Tx } from "../db";
import { assertCan, type TenantContext } from "../context";
import { AppError, NotFoundError } from "../errors";
import { audit } from "../audit";
import { dec, loadSettings, paise, requireCounterparty } from "./common";
import { parseAmount, formatINR, toDecimalString } from "@/domain/money";
import { isISODate, toDbDate, formatDate } from "@/domain/dates";

export const CALL_OUTCOMES: { value: CallOutcome; label: string; noteRequired: boolean }[] = [
  { value: "no_answer", label: "No answer", noteRequired: false },
  { value: "unavailable", label: "Customer unavailable", noteRequired: false },
  { value: "payment_promised", label: "Payment promised", noteRequired: false },
  { value: "part_payment_received", label: "Part payment received", noteRequired: true },
  { value: "payment_completed", label: "Payment completed", noteRequired: true },
  { value: "invoice_dispute", label: "Invoice dispute raised", noteRequired: true },
  { value: "delivery_dispute", label: "Delivery or quantity dispute", noteRequired: true },
  { value: "rate_discrepancy", label: "Rate discrepancy", noteRequired: true },
  { value: "cash_flow_difficulty", label: "Temporary cash-flow difficulty", noteRequired: true },
  { value: "extension_requested", label: "Requested extension", noteRequired: true },
  { value: "refused", label: "Refused to pay", noteRequired: true },
  { value: "wrong_contact", label: "Wrong contact details", noteRequired: true },
  { value: "escalated", label: "Escalated to manager", noteRequired: true },
  { value: "other", label: "Other", noteRequired: true },
];

export const DISPUTE_CATEGORIES = [
  { value: "quantity_mismatch", label: "Quantity mismatch" },
  { value: "rate_mismatch", label: "Rate mismatch" },
  { value: "missing_delivery_docs", label: "Missing delivery documentation" },
  { value: "damaged_goods", label: "Damaged goods" },
  { value: "invoice_discrepancy", label: "Invoice discrepancy" },
  { value: "tax_discrepancy", label: "Tax / GST discrepancy" },
  { value: "allocation_discrepancy", label: "Payment allocation discrepancy" },
  { value: "other", label: "Other" },
] as const;

export const DISPUTE_STATUSES: { value: DisputeStatus; label: string; closed: boolean }[] = [
  { value: "open", label: "Open", closed: false },
  { value: "under_review", label: "Under review", closed: false },
  { value: "awaiting_customer", label: "Awaiting customer", closed: false },
  { value: "awaiting_supplier", label: "Awaiting supplier", closed: false },
  { value: "awaiting_internal", label: "Awaiting internal team", closed: false },
  { value: "resolved", label: "Resolved", closed: true },
  { value: "closed", label: "Closed", closed: true },
];

const optText = (max = 2000) => z.string().max(max).optional().transform((v) => (v && v.trim() !== "" ? v.trim() : null));
const optDate = z.string().optional().transform((v, c) => {
  if (!v || v.trim() === "") return null;
  if (!isISODate(v)) {
    c.addIssue({ code: "custom", message: "Enter a valid date" });
    return z.NEVER;
  }
  return v;
});

async function assertInvoicesBelong(tx: Tx, counterpartyId: string, invoiceIds: string[], direction?: "receivable" | "payable") {
  if (invoiceIds.length === 0) return [];
  const invoices = await tx.invoice.findMany({ where: { id: { in: invoiceIds }, counterpartyId, ...(direction ? { direction } : {}) } });
  if (invoices.length !== new Set(invoiceIds).size) throw new AppError("One or more selected invoices do not belong to this account.");
  return invoices;
}

// ---------------------------------------------------------------- calls / communications

export const callSchema = z
  .object({
    counterpartyId: z.string().uuid(),
    invoiceIds: z.array(z.string().uuid()).default([]),
    channel: z.enum(["call", "email", "whatsapp", "sms", "visit", "note"]).default("call"),
    direction: z.enum(["outbound", "inbound"]).default("outbound"),
    outcome: z.string().optional().transform((v) => (v && v !== "" ? (v as CallOutcome) : null)),
    contactPerson: optText(120),
    notes: optText(),
    // Optional linked actions recorded in the same step.
    nextActionDate: optDate,
    nextActionType: z.enum(["call", "email", "visit", "review", "payment_planning", "other"]).default("call"),
    promiseAmount: z.string().optional(),
    promiseDate: optDate,
    promiseReason: optText(500),
    disputeCategory: z.string().optional(),
    disputeDescription: optText(),
    followUpId: z.string().optional().transform((v) => (v && v !== "" ? v : null)),
  })
  .superRefine((v, c) => {
    if (v.channel === "call" && !v.outcome) c.addIssue({ code: "custom", path: ["outcome"], message: "Select the call outcome" });
    const def = CALL_OUTCOMES.find((o) => o.value === v.outcome);
    if (v.outcome && !def) c.addIssue({ code: "custom", path: ["outcome"], message: "Unknown outcome" });
    if (def?.noteRequired && !v.notes) c.addIssue({ code: "custom", path: ["notes"], message: `Add a note for “${def.label}”` });
    if (v.outcome === "payment_promised" && (!v.promiseAmount || !v.promiseDate)) {
      c.addIssue({ code: "custom", path: ["promiseAmount"], message: "Enter the promised amount and date" });
    }
    if (["invoice_dispute", "delivery_dispute", "rate_discrepancy"].includes(v.outcome ?? "") && v.invoiceIds.length === 0) {
      c.addIssue({ code: "custom", path: ["invoiceIds"], message: "Select the disputed invoice" });
    }
  });

export async function logCommunication(ctx: TenantContext, raw: z.input<typeof callSchema>) {
  assertCan(ctx, "collections.work");
  const input = callSchema.parse(raw);
  return withTenant(ctx.businessId, async (tx) => {
    const cp = await requireCounterparty(tx, input.counterpartyId);
    const invoices = await assertInvoicesBelong(tx, cp.id, input.invoiceIds);
    const comm = await tx.communication.create({
      data: {
        businessId: ctx.businessId,
        counterpartyId: cp.id,
        channel: input.channel,
        direction: input.direction,
        outcome: input.outcome,
        contactPerson: input.contactPerson,
        notes: input.notes,
        contactedAt: new Date(),
        followUpId: input.followUpId,
        createdById: ctx.userId,
        invoices: { create: invoices.map((i) => ({ invoiceId: i.id, businessId: ctx.businessId })) },
      },
    });
    const outcomeLabel = CALL_OUTCOMES.find((o) => o.value === input.outcome)?.label;
    await audit(tx, {
      businessId: ctx.businessId,
      actorUserId: ctx.userId,
      action: "communication.logged",
      entityType: "counterparty",
      entityId: cp.id,
      summary: `${input.channel === "call" ? "Call" : input.channel} with ${cp.name}${outcomeLabel ? `: ${outcomeLabel}` : ""}`,
    });

    // The follow-up that prompted this call is complete.
    if (input.followUpId) {
      await completeFollowUpTx(tx, ctx, input.followUpId, `Logged ${input.channel}${outcomeLabel ? `: ${outcomeLabel}` : ""}`);
    }
    // Contact closes the system "first contact" task for these invoices.
    await tx.followUp.updateMany({
      where: { counterpartyId: cp.id, status: "pending", source: "system_overdue", ...(invoices.length ? { invoiceId: { in: invoices.map((i) => i.id) } } : {}) },
      data: { status: "completed", completedAt: new Date(), completedById: ctx.userId, completionNote: "Contacted" },
    });

    if (input.outcome === "payment_promised" && input.promiseAmount && input.promiseDate) {
      await createPromiseTx(tx, ctx, {
        counterpartyId: cp.id,
        invoiceIds: invoices.map((i) => i.id),
        amount: input.promiseAmount,
        promisedDate: input.promiseDate,
        reason: input.promiseReason ?? undefined,
      });
    }
    if (["invoice_dispute", "delivery_dispute", "rate_discrepancy"].includes(input.outcome ?? "") && invoices[0]) {
      const category = input.disputeCategory && DISPUTE_CATEGORIES.some((d) => d.value === input.disputeCategory)
        ? input.disputeCategory
        : input.outcome === "delivery_dispute" ? "quantity_mismatch" : input.outcome === "rate_discrepancy" ? "rate_mismatch" : "invoice_discrepancy";
      for (const inv of invoices) {
        await createDisputeTx(tx, ctx, { invoiceId: inv.id, category, description: input.disputeDescription ?? input.notes ?? "Raised during call" });
      }
    }
    if (input.nextActionDate) {
      await createFollowUpTx(tx, ctx, {
        counterpartyId: cp.id,
        invoiceId: invoices[0]?.id,
        type: input.nextActionType,
        title: `${input.nextActionType === "call" ? "Call" : "Follow up with"} ${cp.name}${outcomeLabel ? ` (after: ${outcomeLabel})` : ""}`,
        dueDate: input.nextActionDate,
        assignedUserId: ctx.userId,
      });
    }
    return comm;
  });
}

// ---------------------------------------------------------------- follow-ups

export const followUpSchema = z.object({
  counterpartyId: z.string().uuid(),
  invoiceId: z.string().optional().transform((v) => (v && v !== "" ? v : null)),
  type: z.enum(["call", "email", "visit", "review", "escalation", "payment_planning", "other"]).default("call"),
  title: z.string().trim().min(3, "Describe the follow-up").max(200),
  dueDate: z.string().refine(isISODate, "Enter a valid date"),
  assignedUserId: z.string().optional().transform((v) => (v && v !== "" ? v : null)),
  details: optText(),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
});

export async function createFollowUpTx(tx: Tx, ctx: Pick<TenantContext, "businessId" | "userId">, raw: z.input<typeof followUpSchema>) {
  const input = followUpSchema.parse(raw);
  const cp = await requireCounterparty(tx, input.counterpartyId);
  if (input.invoiceId) await assertInvoicesBelong(tx, cp.id, [input.invoiceId]);
  const assignee = input.assignedUserId ?? cp.assignedUserId ?? ctx.userId;
  const m = await tx.membership.findFirst({ where: { businessId: ctx.businessId, userId: assignee, status: "active" } });
  if (!m) throw new AppError("Assigned employee is not a member", { assignedUserId: "Select a team member" });
  const f = await tx.followUp.create({
    data: {
      businessId: ctx.businessId,
      counterpartyId: cp.id,
      invoiceId: input.invoiceId,
      type: input.type,
      title: input.title,
      dueDate: toDbDate(input.dueDate),
      assignedUserId: assignee,
      details: input.details,
      priority: input.priority,
      createdById: ctx.userId,
    },
  });
  await audit(tx, {
    businessId: ctx.businessId,
    actorUserId: ctx.userId,
    action: "followup.scheduled",
    entityType: "counterparty",
    entityId: cp.id,
    summary: `Follow-up scheduled for ${formatDate(input.dueDate)}: ${input.title}`,
  });
  return f;
}

export async function createFollowUp(ctx: TenantContext, raw: z.input<typeof followUpSchema>) {
  assertCan(ctx, "collections.work");
  return withTenant(ctx.businessId, (tx) => createFollowUpTx(tx, ctx, raw));
}

async function completeFollowUpTx(tx: Tx, ctx: Pick<TenantContext, "businessId" | "userId">, id: string, note: string | null) {
  const f = await tx.followUp.findUnique({ where: { id } });
  if (!f) throw new NotFoundError("Follow-up");
  if (f.status !== "pending") return f;
  const updated = await tx.followUp.update({
    where: { id },
    data: { status: "completed", completedAt: new Date(), completedById: ctx.userId, completionNote: note },
  });
  await tx.reminderJob.updateMany({ where: { followUpId: id, status: "pending" }, data: { status: "cancelled", statusReason: "Follow-up completed" } });
  await audit(tx, {
    businessId: ctx.businessId,
    actorUserId: ctx.userId,
    action: "followup.completed",
    entityType: "counterparty",
    entityId: f.counterpartyId,
    summary: `Follow-up completed: ${f.title}${note ? ` — ${note}` : ""}`,
  });
  return updated;
}

export async function completeFollowUp(ctx: TenantContext, id: string, note: string | null) {
  assertCan(ctx, "collections.work");
  return withTenant(ctx.businessId, (tx) => completeFollowUpTx(tx, ctx, id, note));
}

export async function cancelFollowUp(ctx: TenantContext, id: string, reason: string) {
  assertCan(ctx, "collections.work");
  if (!reason || reason.trim().length < 3) throw new AppError("Give a reason", { reason: "Required" });
  return withTenant(ctx.businessId, async (tx) => {
    const f = await tx.followUp.findUnique({ where: { id } });
    if (!f) throw new NotFoundError("Follow-up");
    if (f.status !== "pending") throw new AppError("Only pending follow-ups can be cancelled.");
    await tx.followUp.update({ where: { id }, data: { status: "cancelled", completedAt: new Date(), completedById: ctx.userId, completionNote: reason.trim() } });
    await tx.reminderJob.updateMany({ where: { followUpId: id, status: "pending" }, data: { status: "cancelled", statusReason: "Follow-up cancelled" } });
    await audit(tx, { businessId: ctx.businessId, actorUserId: ctx.userId, action: "followup.cancelled", entityType: "counterparty", entityId: f.counterpartyId, summary: `Follow-up cancelled: ${f.title} — ${reason.trim()}` });
  });
}

export async function rescheduleFollowUp(ctx: TenantContext, id: string, newDate: string, reason: string | null) {
  assertCan(ctx, "collections.work");
  if (!isISODate(newDate)) throw new AppError("Enter a valid date", { dueDate: "Invalid date" });
  return withTenant(ctx.businessId, async (tx) => {
    const f = await tx.followUp.findUnique({ where: { id } });
    if (!f) throw new NotFoundError("Follow-up");
    if (f.status !== "pending") throw new AppError("Only pending follow-ups can be rescheduled.");
    await tx.followUp.update({ where: { id }, data: { dueDate: toDbDate(newDate) } });
    await audit(tx, {
      businessId: ctx.businessId,
      actorUserId: ctx.userId,
      action: "followup.rescheduled",
      entityType: "counterparty",
      entityId: f.counterpartyId,
      summary: `Follow-up “${f.title}” moved to ${formatDate(newDate)}${reason ? `: ${reason}` : ""}`,
      before: { dueDate: f.dueDate },
      after: { dueDate: newDate },
    });
  });
}

// ---------------------------------------------------------------- promises

export const promiseSchema = z.object({
  counterpartyId: z.string().uuid(),
  invoiceIds: z.array(z.string().uuid()).default([]),
  amount: z.string(),
  promisedDate: z.string().refine(isISODate, "Enter the promised date"),
  isFullPayment: z.string().optional().transform((v) => v === "on" || v === "true"),
  reason: z.string().max(500).optional(),
  followUpDate: z.string().optional(),
});

export async function createPromiseTx(tx: Tx, ctx: Pick<TenantContext, "businessId" | "userId" | "today">, raw: z.input<typeof promiseSchema>, parentPromiseId?: string) {
  const input = promiseSchema.parse(raw);
  let amount;
  try {
    amount = parseAmount(input.amount);
  } catch {
    throw new AppError("Enter a valid promised amount", { amount: "Invalid amount" });
  }
  if (amount <= 0n) throw new AppError("Promised amount must be greater than zero", { amount: "Must be positive" });
  if (input.promisedDate < ctx.today) throw new AppError("The promised date cannot be in the past", { promisedDate: "Date is in the past" });
  const cp = await requireCounterparty(tx, input.counterpartyId, "customer");
  const invoices = await assertInvoicesBelong(tx, cp.id, input.invoiceIds, "receivable");
  const outstanding = invoices.length
    ? invoices.reduce((a, i) => a + paise(i.outstandingAmount), 0n)
    : (await tx.invoice.findMany({ where: { counterpartyId: cp.id, direction: "receivable", lifecycle: "open" }, select: { outstandingAmount: true } })).reduce((a, i) => a + paise(i.outstandingAmount), 0n);
  if (amount > outstanding) throw new AppError(`The promised amount exceeds the outstanding balance (${formatINR(outstanding)}).`, { amount: "Exceeds outstanding" });

  const followUpDate = input.followUpDate && isISODate(input.followUpDate) ? input.followUpDate : input.promisedDate;
  const promise = await tx.paymentPromise.create({
    data: {
      businessId: ctx.businessId,
      counterpartyId: cp.id,
      amount: dec(amount),
      promisedDate: toDbDate(input.promisedDate),
      isFullPayment: input.isFullPayment || amount === outstanding,
      reason: input.reason?.trim() || null,
      followUpDate: toDbDate(followUpDate),
      parentPromiseId: parentPromiseId ?? null,
      createdById: ctx.userId,
      invoices: { create: invoices.map((i) => ({ invoiceId: i.id, businessId: ctx.businessId })) },
    },
  });
  // Follow-up on the promised date to confirm receipt.
  await tx.followUp.create({
    data: {
      businessId: ctx.businessId,
      counterpartyId: cp.id,
      invoiceId: invoices[0]?.id ?? null,
      type: "call",
      title: `Confirm promised payment of ${formatINR(amount)} from ${cp.name}`,
      dueDate: toDbDate(followUpDate),
      assignedUserId: cp.assignedUserId ?? ctx.userId,
      source: "system_promise",
      dedupeKey: `promise:${promise.id}:confirm`,
      createdById: ctx.userId,
    },
  });
  await audit(tx, {
    businessId: ctx.businessId,
    actorUserId: ctx.userId,
    action: "promise.created",
    entityType: "counterparty",
    entityId: cp.id,
    summary: `${cp.name} promised ${formatINR(amount)} by ${formatDate(input.promisedDate)}${invoices.length ? ` against ${invoices.map((i) => i.invoiceNumber).join(", ")}` : ""}`,
    after: { promiseId: promise.id, amount, promisedDate: input.promisedDate, reason: input.reason },
  });
  return promise;
}

export async function createPromise(ctx: TenantContext, raw: z.input<typeof promiseSchema>) {
  assertCan(ctx, "collections.work");
  return withTenant(ctx.businessId, (tx) => createPromiseTx(tx, ctx, raw));
}

export async function cancelPromise(ctx: TenantContext, id: string, reason: string) {
  assertCan(ctx, "collections.work");
  if (!reason || reason.trim().length < 3) throw new AppError("Give a reason for cancelling", { reason: "Required" });
  return withTenant(ctx.businessId, async (tx) => {
    const p = await tx.paymentPromise.findUnique({ where: { id } });
    if (!p) throw new NotFoundError("Promise");
    if (p.status !== "upcoming") throw new AppError("Only upcoming promises can be cancelled; evaluated outcomes are kept as history.");
    await tx.paymentPromise.update({ where: { id }, data: { status: "cancelled", cancelReason: reason.trim() } });
    await tx.followUp.updateMany({ where: { dedupeKey: `promise:${id}:confirm`, status: "pending" }, data: { status: "cancelled", completionNote: "Promise cancelled" } });
    await audit(tx, { businessId: ctx.businessId, actorUserId: ctx.userId, action: "promise.cancelled", entityType: "counterparty", entityId: p.counterpartyId, summary: `Promise of ${formatINR(paise(p.amount))} cancelled: ${reason.trim()}` });
  });
}

/** Records an authorised review of an ambiguous promise outcome (e.g. late or partial payment). */
export async function reviewPromise(ctx: TenantContext, id: string, note: string, carryRemainder: { date: string } | null) {
  assertCan(ctx, "collections.work");
  if (!note || note.trim().length < 3) throw new AppError("Add a review note", { note: "Required" });
  return withTenant(ctx.businessId, async (tx) => {
    const p = await tx.paymentPromise.findUnique({ where: { id }, include: { invoices: true } });
    if (!p) throw new NotFoundError("Promise");
    await tx.paymentPromise.update({ where: { id }, data: { needsReview: false, reviewNote: note.trim() } });
    await audit(tx, { businessId: ctx.businessId, actorUserId: ctx.userId, action: "promise.reviewed", entityType: "counterparty", entityId: p.counterpartyId, summary: `Promise outcome reviewed (${p.status}): ${note.trim()}` });
    if (carryRemainder && p.status === "partially_kept") {
      const remainder = paise(p.amount) - paise(p.amountReceived);
      if (remainder > 0n) {
        await createPromiseTx(tx, ctx, { counterpartyId: p.counterpartyId, invoiceIds: p.invoices.map((i) => i.invoiceId), amount: toDecimalString(remainder), promisedDate: carryRemainder.date, reason: `Remainder of earlier promise` }, p.id);
      }
    }
  });
}

// ---------------------------------------------------------------- disputes

export const disputeSchema = z.object({
  invoiceId: z.string().uuid(),
  category: z.string(),
  description: z.string().trim().min(3, "Describe the dispute").max(2000),
  disputedAmount: z.string().optional(),
  assignedUserId: z.string().optional(),
  collectionHold: z.string().optional().transform((v) => v === "on" || v === "true"),
  holdReason: z.string().max(500).optional(),
});

export async function createDisputeTx(tx: Tx, ctx: Pick<TenantContext, "businessId" | "userId" | "today">, raw: z.input<typeof disputeSchema>) {
  const input = disputeSchema.parse(raw);
  if (!DISPUTE_CATEGORIES.some((c) => c.value === input.category)) throw new AppError("Choose a dispute category", { category: "Required" });
  const inv = await tx.invoice.findUnique({ where: { id: input.invoiceId } });
  if (!inv) throw new NotFoundError("Invoice");
  if (input.collectionHold && (!input.holdReason || input.holdReason.trim().length < 3)) {
    throw new AppError("Document why collections are on hold", { holdReason: "Required for a hold" });
  }
  let disputedAmount = null;
  if (input.disputedAmount && input.disputedAmount.trim() !== "") {
    disputedAmount = parseAmount(input.disputedAmount);
    if (disputedAmount < 0n || disputedAmount > paise(inv.totalAmount)) throw new AppError("Disputed amount must be between zero and the invoice total", { disputedAmount: "Out of range" });
  }
  const d = await tx.dispute.create({
    data: {
      businessId: ctx.businessId,
      invoiceId: inv.id,
      counterpartyId: inv.counterpartyId,
      category: input.category as never,
      description: input.description,
      raisedOn: toDbDate(ctx.today),
      assignedUserId: input.assignedUserId && input.assignedUserId !== "" ? input.assignedUserId : inv.assignedUserId ?? ctx.userId,
      disputedAmount: disputedAmount !== null ? dec(disputedAmount) : null,
      collectionHold: input.collectionHold,
      holdReason: input.collectionHold ? input.holdReason!.trim() : null,
      createdById: ctx.userId,
      updates: { create: { businessId: ctx.businessId, toStatus: "open", note: input.description, createdById: ctx.userId } },
    },
  });
  await audit(tx, {
    businessId: ctx.businessId,
    actorUserId: ctx.userId,
    action: "dispute.opened",
    entityType: "invoice",
    entityId: inv.id,
    summary: `Dispute opened on ${inv.invoiceNumber}: ${DISPUTE_CATEGORIES.find((c) => c.value === input.category)?.label}${input.collectionHold ? " (collections on hold)" : ""}`,
    after: { disputeId: d.id, category: input.category, hold: input.collectionHold },
  });
  return d;
}

export async function createDispute(ctx: TenantContext, raw: z.input<typeof disputeSchema>) {
  assertCan(ctx, "collections.work");
  return withTenant(ctx.businessId, (tx) => createDisputeTx(tx, ctx, raw));
}

export async function updateDispute(ctx: TenantContext, id: string, raw: { status: string; note?: string; resolutionNotes?: string; collectionHold?: string; holdReason?: string }) {
  assertCan(ctx, "collections.work");
  const status = DISPUTE_STATUSES.find((s) => s.value === raw.status);
  if (!status) throw new AppError("Choose a status", { status: "Required" });
  return withTenant(ctx.businessId, async (tx) => {
    const d = await tx.dispute.findUnique({ where: { id }, include: { invoice: { select: { invoiceNumber: true } } } });
    if (!d) throw new NotFoundError("Dispute");
    if (status.closed && (!raw.resolutionNotes || raw.resolutionNotes.trim().length < 3)) {
      throw new AppError("Record how the dispute was resolved", { resolutionNotes: "Required to resolve or close" });
    }
    const hold = raw.collectionHold === "on" || raw.collectionHold === "true";
    if (hold && !status.closed && (!raw.holdReason || raw.holdReason.trim().length < 3)) throw new AppError("Document why collections are on hold", { holdReason: "Required for a hold" });
    await tx.dispute.update({
      where: { id },
      data: {
        status: status.value,
        resolutionNotes: status.closed ? raw.resolutionNotes!.trim() : d.resolutionNotes,
        resolvedOn: status.closed ? toDbDate(ctx.today) : null,
        collectionHold: status.closed ? false : hold,
        holdReason: status.closed ? null : hold ? raw.holdReason!.trim() : null,
        lastActivityAt: new Date(),
        updates: { create: { businessId: ctx.businessId, fromStatus: d.status, toStatus: status.value, note: raw.note?.trim() || raw.resolutionNotes?.trim() || null, createdById: ctx.userId } },
      },
    });
    await audit(tx, {
      businessId: ctx.businessId,
      actorUserId: ctx.userId,
      action: "dispute.status_changed",
      entityType: "invoice",
      entityId: d.invoiceId,
      summary: `Dispute on ${d.invoice.invoiceNumber}: ${d.status} → ${status.value}${raw.note ? ` — ${raw.note.trim()}` : ""}`,
      before: { status: d.status, hold: d.collectionHold },
      after: { status: status.value, hold: status.closed ? false : hold },
    });
  });
}

// ---------------------------------------------------------------- planned supplier payments

export const plannedPaymentSchema = z.object({
  invoiceId: z.string().uuid(),
  plannedDate: z.string().refine(isISODate, "Enter a valid date"),
  amount: z.string(),
  promisedToSupplier: z.string().optional().transform((v) => v === "on" || v === "true"),
  notes: optText(500),
});

export async function schedulePlannedPayment(ctx: TenantContext, raw: z.input<typeof plannedPaymentSchema>) {
  assertCan(ctx, "payables.manage");
  const input = plannedPaymentSchema.parse(raw);
  const amount = parseAmount(input.amount);
  if (amount <= 0n) throw new AppError("Amount must be greater than zero", { amount: "Must be positive" });
  if (input.plannedDate < ctx.today) throw new AppError("Planned date cannot be in the past", { plannedDate: "In the past" });
  return withTenant(ctx.businessId, async (tx) => {
    const inv = await tx.invoice.findUnique({ where: { id: input.invoiceId } });
    if (!inv || inv.direction !== "payable") throw new NotFoundError("Bill");
    if (inv.lifecycle !== "open") throw new AppError("Payments can only be planned for open bills.");
    const scheduled = await tx.plannedPayment.findMany({ where: { invoiceId: inv.id, status: "scheduled" } });
    const already = scheduled.reduce((a, p) => a + paise(p.amount), 0n);
    if (already + amount > paise(inv.outstandingAmount)) {
      throw new AppError(`Planned payments would exceed the outstanding balance (${formatINR(paise(inv.outstandingAmount))}, ${formatINR(already)} already planned).`, { amount: "Exceeds outstanding" });
    }
    const pp = await tx.plannedPayment.create({
      data: { businessId: ctx.businessId, invoiceId: inv.id, plannedDate: toDbDate(input.plannedDate), amount: dec(amount), promisedToSupplier: input.promisedToSupplier, notes: input.notes, createdById: ctx.userId },
    });
    await tx.reminderJob.createMany({
      data: [{ businessId: ctx.businessId, type: "planned_payment_due", dedupeKey: `planned:${pp.id}:${input.plannedDate}`, scheduledFor: toDbDate(input.plannedDate), invoiceId: inv.id, plannedPaymentId: pp.id, counterpartyId: inv.counterpartyId }],
      skipDuplicates: true,
    });
    await audit(tx, {
      businessId: ctx.businessId,
      actorUserId: ctx.userId,
      action: "planned_payment.scheduled",
      entityType: "invoice",
      entityId: inv.id,
      summary: `Payment of ${formatINR(amount)} planned for ${formatDate(input.plannedDate)}${input.promisedToSupplier ? " (promised to supplier)" : ""} — not yet paid`,
    });
    return pp;
  });
}

export async function reschedulePlannedPayment(ctx: TenantContext, id: string, newDate: string, reason: string) {
  assertCan(ctx, "payables.manage");
  if (!isISODate(newDate)) throw new AppError("Enter a valid date", { plannedDate: "Invalid" });
  if (newDate < ctx.today) throw new AppError("New date cannot be in the past", { plannedDate: "In the past" });
  if (!reason || reason.trim().length < 3) throw new AppError("Give a reason for rescheduling", { reason: "Required" });
  return withTenant(ctx.businessId, async (tx) => {
    const pp = await tx.plannedPayment.findUnique({ where: { id }, include: { invoice: true } });
    if (!pp) throw new NotFoundError("Planned payment");
    if (pp.status !== "scheduled") throw new AppError("Only scheduled payments can be rescheduled.");
    await tx.plannedPayment.update({ where: { id }, data: { plannedDate: toDbDate(newDate), rescheduleCount: { increment: 1 } } });
    await tx.reminderJob.updateMany({ where: { plannedPaymentId: id, status: "pending" }, data: { status: "cancelled", statusReason: "Planned payment rescheduled" } });
    await tx.reminderJob.createMany({
      data: [{ businessId: ctx.businessId, type: "planned_payment_due", dedupeKey: `planned:${id}:${newDate}`, scheduledFor: toDbDate(newDate), invoiceId: pp.invoiceId, plannedPaymentId: id, counterpartyId: pp.invoice.counterpartyId }],
      skipDuplicates: true,
    });
    await audit(tx, {
      businessId: ctx.businessId,
      actorUserId: ctx.userId,
      action: "planned_payment.rescheduled",
      entityType: "invoice",
      entityId: pp.invoiceId,
      summary: `Planned payment moved ${formatDate(pp.plannedDate)} → ${formatDate(newDate)}: ${reason.trim()}`,
      before: { plannedDate: pp.plannedDate },
      after: { plannedDate: newDate, reason: reason.trim() },
    });
  });
}

export async function cancelPlannedPayment(ctx: TenantContext, id: string, reason: string) {
  assertCan(ctx, "payables.manage");
  if (!reason || reason.trim().length < 3) throw new AppError("Give a reason", { reason: "Required" });
  return withTenant(ctx.businessId, async (tx) => {
    const pp = await tx.plannedPayment.findUnique({ where: { id } });
    if (!pp) throw new NotFoundError("Planned payment");
    if (pp.status !== "scheduled") throw new AppError("Only scheduled payments can be cancelled.");
    await tx.plannedPayment.update({ where: { id }, data: { status: "cancelled", notes: [pp.notes, `Cancelled: ${reason.trim()}`].filter(Boolean).join("\n") } });
    await tx.reminderJob.updateMany({ where: { plannedPaymentId: id, status: "pending" }, data: { status: "cancelled", statusReason: "Planned payment cancelled" } });
    await audit(tx, { businessId: ctx.businessId, actorUserId: ctx.userId, action: "planned_payment.cancelled", entityType: "invoice", entityId: pp.invoiceId, summary: `Planned payment of ${formatINR(paise(pp.amount))} cancelled: ${reason.trim()}` });
  });
}

export async function loadSettingsFor(ctx: TenantContext) {
  return withTenant(ctx.businessId, (tx) => loadSettings(tx, ctx.businessId));
}
