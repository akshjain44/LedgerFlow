import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { prisma } from "./db";
import { getSession } from "./auth/session";
import { effectivePermissions, type Permission, type Role } from "@/domain/permissions";
import { ForbiddenError } from "./errors";
import { todayIn } from "@/domain/dates";

export interface TenantContext {
  userId: string;
  userName: string;
  userEmail: string;
  sessionId: string;
  businessId: string;
  businessName: string;
  timezone: string;
  isDemo: boolean;
  role: Role;
  permissions: Set<Permission>;
  memberships: { businessId: string; businessName: string; role: Role }[];
  today: string;
}

/** Signed-in user or redirect to /login. */
export async function requireUser() {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

/**
 * Resolves the active business for the request. The business id comes from
 * the server-side session and is re-checked against an active membership on
 * every request; nothing supplied by the browser is trusted.
 */
export const getTenantContext = cache(async (): Promise<TenantContext | null> => {
  const session = await getSession();
  if (!session) return null;
  const memberships = await prisma.membership.findMany({
    where: { userId: session.userId, status: "active" },
    include: { business: { select: { id: true, name: true, timezone: true, isDemo: true } } },
    orderBy: { createdAt: "asc" },
  });
  if (memberships.length === 0) return null;
  const active = memberships.find((m) => m.businessId === session.activeBusinessId) ?? memberships[0];
  return {
    userId: session.userId,
    userName: session.user.name,
    userEmail: session.user.email,
    sessionId: session.id,
    businessId: active.businessId,
    businessName: active.business.name,
    timezone: active.business.timezone,
    isDemo: active.business.isDemo,
    role: active.role,
    permissions: effectivePermissions(active.role, active.permissions),
    memberships: memberships.map((m) => ({ businessId: m.businessId, businessName: m.business.name, role: m.role })),
    today: todayIn(active.business.timezone),
  };
});

/** For pages: signed in + member of a business, else redirect to login/onboarding. */
export async function requireTenant(permission?: Permission): Promise<TenantContext> {
  await requireUser();
  const ctx = await getTenantContext();
  if (!ctx) redirect("/onboarding");
  if (permission && !ctx.permissions.has(permission)) redirect("/forbidden");
  return ctx;
}

/** For server actions and route handlers: throws instead of redirecting. */
export async function tenantOrThrow(permission?: Permission): Promise<TenantContext> {
  const ctx = await getTenantContext();
  if (!ctx) throw new ForbiddenError("Your session has expired. Please sign in again.");
  if (permission && !ctx.permissions.has(permission)) throw new ForbiddenError();
  return ctx;
}

export function can(ctx: Pick<TenantContext, "permissions">, permission: Permission): boolean {
  return ctx.permissions.has(permission);
}

export function assertCan(ctx: Pick<TenantContext, "permissions">, permission: Permission) {
  if (!ctx.permissions.has(permission)) throw new ForbiddenError();
}
