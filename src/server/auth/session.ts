import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { prisma } from "../db";
import { isProduction } from "../config";
import { hashToken, newToken } from "./password";

export const SESSION_COOKIE = "lf_session";
const SESSION_DAYS = 14;

export async function createSession(userId: string, activeBusinessId?: string | null) {
  const { token, hash } = newToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await prisma.session.create({ data: { userId, tokenHash: hash, expiresAt, activeBusinessId: activeBusinessId ?? null } });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  jar.delete(SESSION_COOKIE);
}

export type SessionWithUser = NonNullable<Awaited<ReturnType<typeof getSession>>>;

/** Validates the session cookie against the database. Cached per request. */
export const getSession = cache(async () => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: { id: true, email: true, name: true, isActive: true } } },
  });
  if (!session || session.expiresAt < new Date() || !session.user.isActive) return null;
  return session;
});

export async function setActiveBusiness(sessionId: string, businessId: string) {
  await prisma.session.update({ where: { id: sessionId }, data: { activeBusinessId: businessId } });
}
