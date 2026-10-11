import "server-only";
import { z } from "zod";
import { prisma, withSystem } from "../db";
import { AppError } from "../errors";
import { hashPassword, hashToken, newToken, verifyPassword } from "../auth/password";
import { assertNotRateLimited, recordAttempt } from "../auth/rateLimit";
import { createSession, destroySession } from "../auth/session";
import { getEmailProvider } from "../email";
import { appUrl, APP_NAME, isProduction } from "../config";

const password = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(200)
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), "Include at least one letter and one number");

export const signUpSchema = z.object({
  name: z.string().trim().min(2, "Enter your name").max(100),
  email: z.email("Enter a valid email").transform((e) => e.trim().toLowerCase()),
  password,
});

export async function signUp(raw: z.input<typeof signUpSchema>) {
  const input = signUpSchema.parse(raw);
  await assertNotRateLimited("signup", input.email);
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    await recordAttempt("signup", input.email, false);
    throw new AppError("An account with this email already exists. Sign in instead.", { email: "Already registered" });
  }
  const user = await prisma.user.create({ data: { name: input.name, email: input.email, passwordHash: await hashPassword(input.password) } });
  await createSession(user.id);
  return user;
}

export async function signIn(emailRaw: string, pw: string) {
  const email = (emailRaw ?? "").trim().toLowerCase();
  if (!email || !pw) throw new AppError("Enter your email and password.");
  await assertNotRateLimited("login", email);
  const user = await prisma.user.findUnique({ where: { email } });
  const ok = user?.isActive ? await verifyPassword(pw, user.passwordHash) : false;
  await recordAttempt("login", email, ok);
  if (!user || !ok) throw new AppError("Email or password is incorrect.");
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await createSession(user.id);
  return user;
}

export async function signOut() {
  await destroySession();
}

/**
 * Always reports success to avoid revealing which emails are registered.
 * Without an email provider, the link is printed to the server console in
 * development only; in production the attempt fails visibly in server logs.
 */
export async function requestPasswordReset(emailRaw: string): Promise<{ deliveredBy: "email" | "dev-console" | "unavailable" | "none" }> {
  const email = (emailRaw ?? "").trim().toLowerCase();
  if (!z.email().safeParse(email).success) throw new AppError("Enter a valid email", { email: "Invalid email" });
  await assertNotRateLimited("reset", email);
  await recordAttempt("reset", email, false); // every request counts toward the limit
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive) return { deliveredBy: "none" };
  const { token, hash } = newToken();
  await prisma.passwordReset.create({ data: { userId: user.id, tokenHash: hash, expiresAt: new Date(Date.now() + 60 * 60_000) } });
  const link = `${appUrl()}/reset-password/${token}`;
  const provider = getEmailProvider();
  if (provider) {
    const r = await provider.send({ to: user.email, subject: `Reset your ${APP_NAME} password`, text: `Use this link within one hour to choose a new password:\n\n${link}\n\nIf you did not ask for this, ignore this email.` });
    if (r.ok) return { deliveredBy: "email" };
    console.error("[auth] password reset email failed:", r.error);
    return { deliveredBy: "unavailable" };
  }
  if (!isProduction) {
    console.info(`[auth] DEV ONLY — email not configured. Password reset link for ${user.email}: ${link}`);
    return { deliveredBy: "dev-console" };
  }
  console.error("[auth] password reset requested but no email provider is configured");
  return { deliveredBy: "unavailable" };
}

export async function resetPassword(token: string, pw: string) {
  const parsed = password.safeParse(pw);
  if (!parsed.success) throw new AppError(parsed.error.issues[0].message, { password: parsed.error.issues[0].message });
  const reset = await prisma.passwordReset.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!reset || reset.usedAt || reset.expiresAt < new Date()) throw new AppError("This reset link is invalid or has expired. Request a new one.");
  await prisma.$transaction([
    prisma.user.update({ where: { id: reset.userId }, data: { passwordHash: await hashPassword(pw) } }),
    prisma.passwordReset.update({ where: { id: reset.id }, data: { usedAt: new Date() } }),
    prisma.session.deleteMany({ where: { userId: reset.userId } }),
  ]);
  await createSession(reset.userId);
}

/** Validates an invitation token for display (no side effects). */
export async function peekInvitation(token: string) {
  return withSystem(async (tx) => {
    const inv = await tx.invitation.findUnique({ where: { tokenHash: hashToken(token) }, include: { business: { select: { name: true } } } });
    if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt < new Date()) return null;
    return { email: inv.email, role: inv.role, businessName: inv.business.name };
  });
}
