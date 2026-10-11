import "server-only";
import { z } from "zod";
import { prisma, withSystem, withTenant } from "../db";
import { assertCan, type TenantContext } from "../context";
import { AppError, ForbiddenError, NotFoundError } from "../errors";
import { audit } from "../audit";
import { hashToken, newToken } from "../auth/password";
import { setActiveBusiness } from "../auth/session";
import { getEmailProvider } from "../email";
import { appUrl, APP_NAME } from "../config";
import { ALL_PERMISSIONS, DEFAULT_STAFF_PERMISSIONS, ROLE_LABELS, type Permission } from "@/domain/permissions";

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const optText = (max = 300) => z.string().max(max).optional().transform((v) => (v && v.trim() !== "" ? v.trim() : null));
const days = (label: string) =>
  z.string().transform((v, c) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 365) {
      c.addIssue({ code: "custom", message: `${label} must be 0–365 days` });
      return z.NEVER;
    }
    return n;
  });

export function validTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const businessSchema = z.object({
  name: z.string().trim().min(2, "Business name is required").max(150),
  legalName: optText(200),
  businessType: optText(100),
  gstin: z
    .string()
    .optional()
    .transform((v, c) => {
      if (!v || !v.trim()) return null;
      const t = v.trim().toUpperCase();
      if (!GSTIN_RE.test(t)) {
        c.addIssue({ code: "custom", message: "GSTIN format looks wrong (15 characters)" });
        return z.NEVER;
      }
      return t;
    }),
  address: optText(500),
  contactEmail: z.string().optional().transform((v, c) => {
    if (!v || !v.trim()) return null;
    if (!z.email().safeParse(v.trim()).success) {
      c.addIssue({ code: "custom", message: "Enter a valid email" });
      return z.NEVER;
    }
    return v.trim().toLowerCase();
  }),
  contactPhone: optText(30),
  currency: z.string().default("INR").refine((c) => c === "INR", "Only INR is supported in this version"),
  timezone: z.string().default("Asia/Kolkata").refine(validTimezone, "Unknown timezone"),
  defaultCustomerCreditDays: days("Customer credit period"),
  defaultSupplierCreditDays: days("Supplier payment period"),
});

const hour = z.string().transform((v, c) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 24) {
    c.addIssue({ code: "custom", message: "Enter an hour 0–24" });
    return z.NEVER;
  }
  return n;
});

const offsets = z.string().transform((v, c) => {
  const parts = v.split(/[,\s]+/).filter(Boolean).map(Number);
  if (parts.some((n) => !Number.isInteger(n) || n < -60 || n > 365)) {
    c.addIssue({ code: "custom", message: "Use whole numbers like -3, -1, 0, 1, 7" });
    return z.NEVER;
  }
  return [...new Set(parts)].sort((a, b) => a - b);
});

export const reminderSettingsSchema = z
  .object({
    workingDays: z.array(z.string()).default([]).transform((a) => a.map(Number).filter((n) => n >= 1 && n <= 7)),
    reminderStartHour: hour,
    reminderEndHour: hour,
    receivableReminderOffsets: offsets,
    payableReminderOffsets: offsets,
    remindersEnabled: z.string().optional().transform((v) => v === "on"),
    emailNotificationsEnabled: z.string().optional().transform((v) => v === "on"),
    brokenPromiseThreshold: z.string().transform((v) => Math.max(1, Math.min(10, Number(v) || 2))),
    brokenPromiseWindowDays: z.string().transform((v) => Math.max(7, Math.min(365, Number(v) || 90))),
    financeManagerOverdueDays: z.string().transform((v) => Math.max(0, Math.min(365, Number(v) || 7))),
    disputeReviewDays: z.string().transform((v) => Math.max(1, Math.min(90, Number(v) || 7))),
    disputePolicy: z.enum(["continue", "hold"]),
  })
  .refine((v) => v.reminderStartHour < v.reminderEndHour, { path: ["reminderEndHour"], message: "End hour must be after start hour" })
  .refine((v) => v.workingDays.length > 0, { path: ["workingDays"], message: "Choose at least one working day" });

/** Onboarding: creates the business, its settings and the owner membership. */
export async function createBusiness(userId: string, sessionId: string, raw: z.input<typeof businessSchema> & { reminderPreset?: string; workingDays?: string[] }) {
  const input = businessSchema.parse(raw);
  const workingDays = (raw.workingDays ?? ["1", "2", "3", "4", "5", "6"]).map(Number).filter((n) => n >= 1 && n <= 7);
  const preset = raw.reminderPreset === "light" ? { r: [-1, 0, 3, 7, 15, 30], p: [-3, 0] } : { r: [-3, -1, 0, 1, 3, 7, 15, 30], p: [-3, -1, 0, 1, 7] };
  const business = await withSystem(async (tx) => {
    const b = await tx.business.create({ data: input });
    await tx.businessSettings.create({ data: { businessId: b.id, workingDays: workingDays.length ? workingDays : [1, 2, 3, 4, 5, 6], receivableReminderOffsets: preset.r, payableReminderOffsets: preset.p } });
    await tx.membership.create({ data: { businessId: b.id, userId, role: "owner" } });
    await audit(tx, { businessId: b.id, actorUserId: userId, action: "business.created", entityType: "business", entityId: b.id, summary: `Business ${b.name} created` });
    return b;
  });
  await setActiveBusiness(sessionId, business.id);
  return business;
}

export async function switchBusiness(ctx: TenantContext, businessId: string) {
  if (!ctx.memberships.some((m) => m.businessId === businessId)) throw new ForbiddenError("You are not a member of that business.");
  await setActiveBusiness(ctx.sessionId, businessId);
}

export async function updateBusiness(ctx: TenantContext, raw: z.input<typeof businessSchema>) {
  assertCan(ctx, "settings.manage");
  const input = businessSchema.parse(raw);
  await withTenant(ctx.businessId, async (tx) => {
    const before = await tx.business.findUniqueOrThrow({ where: { id: ctx.businessId } });
    await tx.business.update({ where: { id: ctx.businessId }, data: input });
    await audit(tx, { businessId: ctx.businessId, actorUserId: ctx.userId, action: "settings.business_updated", entityType: "business", entityId: ctx.businessId, summary: "Business details updated", before: { name: before.name, timezone: before.timezone, defaultCustomerCreditDays: before.defaultCustomerCreditDays, defaultSupplierCreditDays: before.defaultSupplierCreditDays }, after: { name: input.name, timezone: input.timezone, defaultCustomerCreditDays: input.defaultCustomerCreditDays, defaultSupplierCreditDays: input.defaultSupplierCreditDays } });
  });
}

export async function updateReminderSettings(ctx: TenantContext, raw: z.input<typeof reminderSettingsSchema>) {
  assertCan(ctx, "settings.manage");
  const input = reminderSettingsSchema.parse(raw);
  await withTenant(ctx.businessId, async (tx) => {
    const before = await tx.businessSettings.findUniqueOrThrow({ where: { businessId: ctx.businessId } });
    await tx.businessSettings.update({ where: { businessId: ctx.businessId }, data: input });
    await audit(tx, { businessId: ctx.businessId, actorUserId: ctx.userId, action: "settings.reminders_updated", entityType: "business", entityId: ctx.businessId, summary: "Reminder and escalation settings updated", before: { offsets: before.receivableReminderOffsets, threshold: before.brokenPromiseThreshold, enabled: before.remindersEnabled }, after: { offsets: input.receivableReminderOffsets, threshold: input.brokenPromiseThreshold, enabled: input.remindersEnabled } });
  });
}

export async function updateFinancialSettings(ctx: TenantContext, raw: { paymentMethods: string; invoicePrefix?: string; priorityWeights?: string }) {
  assertCan(ctx, "settings.manage");
  const methods = [...new Set(raw.paymentMethods.split("\n").map((s) => s.trim()).filter(Boolean))];
  if (methods.length === 0) throw new AppError("Keep at least one payment method", { paymentMethods: "Required" });
  if (methods.some((m) => m.length > 60)) throw new AppError("Payment method names must be under 60 characters", { paymentMethods: "Too long" });
  let weights: unknown = undefined;
  if (raw.priorityWeights && raw.priorityWeights.trim()) {
    try {
      weights = JSON.parse(raw.priorityWeights);
      if (typeof weights !== "object" || Array.isArray(weights) || weights === null) throw new Error();
    } catch {
      throw new AppError("Priority weights must be a JSON object, e.g. {\"brokenPromise\": 35}", { priorityWeights: "Invalid JSON" });
    }
  }
  await withTenant(ctx.businessId, async (tx) => {
    await tx.businessSettings.update({ where: { businessId: ctx.businessId }, data: { paymentMethods: methods, invoicePrefix: raw.invoicePrefix?.trim() || null, ...(weights !== undefined ? { priorityWeights: weights as object } : {}) } });
    await audit(tx, { businessId: ctx.businessId, actorUserId: ctx.userId, action: "settings.financial_updated", entityType: "business", entityId: ctx.businessId, summary: "Financial settings updated", after: { paymentMethods: methods, weights } });
  });
}

// ---------------------------------------------------------------- members

export const inviteSchema = z.object({
  email: z.email("Enter a valid email").transform((e) => e.trim().toLowerCase()),
  role: z.enum(["owner", "finance_manager", "staff"]),
  permissions: z.array(z.string()).default([]),
});

export async function inviteMember(ctx: TenantContext, raw: z.input<typeof inviteSchema>) {
  assertCan(ctx, "members.manage");
  const input = inviteSchema.parse(raw);
  if (input.role === "owner" && ctx.role !== "owner") throw new ForbiddenError("Only an owner can invite another owner.");
  const perms = input.role === "staff" ? (input.permissions.length ? input.permissions : DEFAULT_STAFF_PERMISSIONS).filter((p) => ALL_PERMISSIONS.includes(p as Permission)) : [];
  const { token, hash } = newToken();
  const link = `${appUrl()}/invite/${token}`;
  await withTenant(ctx.businessId, async (tx) => {
    const existingUser = await tx.user.findUnique({ where: { email: input.email } });
    if (existingUser && (await tx.membership.findFirst({ where: { businessId: ctx.businessId, userId: existingUser.id } }))) {
      throw new AppError("That person is already a member.", { email: "Already a member" });
    }
    await tx.invitation.updateMany({ where: { email: input.email, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.invitation.create({ data: { businessId: ctx.businessId, email: input.email, role: input.role, permissions: perms, tokenHash: hash, invitedById: ctx.userId, expiresAt: new Date(Date.now() + 7 * 86_400_000) } });
    await audit(tx, { businessId: ctx.businessId, actorUserId: ctx.userId, action: "member.invited", entityType: "member", summary: `${input.email} invited as ${ROLE_LABELS[input.role]}`, after: { email: input.email, role: input.role, permissions: perms } });
  });
  const provider = getEmailProvider();
  let emailed = false;
  if (provider) {
    const r = await provider.send({ to: input.email, subject: `You're invited to ${ctx.businessName} on ${APP_NAME}`, text: `${ctx.userName} invited you to join ${ctx.businessName} as ${ROLE_LABELS[input.role]}.\n\nAccept within 7 days: ${link}` });
    emailed = r.ok;
  }
  // The link is shown once to the inviting admin so it can be shared directly when email is not configured.
  return { link, emailed };
}

export async function acceptInvitation(userId: string, userEmail: string, sessionId: string, token: string) {
  const businessId = await withSystem(async (tx) => {
    const inv = await tx.invitation.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt < new Date()) throw new AppError("This invitation is invalid or has expired.");
    if (inv.email !== userEmail.toLowerCase()) throw new AppError(`This invitation was sent to ${inv.email}. Sign in with that email to accept it.`);
    const existing = await tx.membership.findFirst({ where: { businessId: inv.businessId, userId } });
    if (!existing) await tx.membership.create({ data: { businessId: inv.businessId, userId, role: inv.role, permissions: inv.permissions } });
    await tx.invitation.update({ where: { id: inv.id }, data: { acceptedAt: new Date() } });
    await audit(tx, { businessId: inv.businessId, actorUserId: userId, action: "member.joined", entityType: "member", entityId: userId, summary: `${userEmail} joined as ${ROLE_LABELS[inv.role]}` });
    return inv.businessId;
  });
  await setActiveBusiness(sessionId, businessId);
}

export async function revokeInvitation(ctx: TenantContext, id: string) {
  assertCan(ctx, "members.manage");
  await withTenant(ctx.businessId, async (tx) => {
    const inv = await tx.invitation.findUnique({ where: { id } });
    if (!inv) throw new NotFoundError("Invitation");
    await tx.invitation.update({ where: { id }, data: { revokedAt: new Date() } });
    await audit(tx, { businessId: ctx.businessId, actorUserId: ctx.userId, action: "member.invite_revoked", entityType: "member", summary: `Invitation for ${inv.email} revoked` });
  });
}

export async function updateMember(ctx: TenantContext, membershipId: string, raw: { role: string; permissions: string[]; status: string }) {
  assertCan(ctx, "members.manage");
  const role = z.enum(["owner", "finance_manager", "staff"]).parse(raw.role);
  const status = z.enum(["active", "suspended"]).parse(raw.status);
  const perms = role === "staff" ? raw.permissions.filter((p) => ALL_PERMISSIONS.includes(p as Permission) && p !== "settings.manage" && p !== "members.manage") : [];
  await withTenant(ctx.businessId, async (tx) => {
    const m = await tx.membership.findFirst({ where: { id: membershipId, businessId: ctx.businessId }, include: { user: { select: { email: true } } } });
    if (!m) throw new NotFoundError("Member");
    if ((m.role === "owner" || role === "owner") && ctx.role !== "owner") throw new ForbiddenError("Only an owner can change an owner's role.");
    if (m.role === "owner" && (role !== "owner" || status !== "active")) {
      const owners = await tx.membership.count({ where: { businessId: ctx.businessId, role: "owner", status: "active" } });
      if (owners <= 1) throw new AppError("A business must keep at least one active owner.");
    }
    await tx.membership.update({ where: { id: m.id }, data: { role, permissions: perms, status } });
    if (status === "suspended") await prisma.session.updateMany({ where: { userId: m.userId, activeBusinessId: ctx.businessId }, data: { activeBusinessId: null } });
    await audit(tx, {
      businessId: ctx.businessId,
      actorUserId: ctx.userId,
      action: "member.updated",
      entityType: "member",
      entityId: m.userId,
      summary: `${m.user.email}: ${ROLE_LABELS[m.role]} → ${ROLE_LABELS[role]}${status !== m.status ? `, ${status}` : ""}`,
      before: { role: m.role, permissions: m.permissions, status: m.status },
      after: { role, permissions: perms, status },
    });
  });
}
