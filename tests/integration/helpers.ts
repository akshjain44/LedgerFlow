import { randomUUID } from "node:crypto";
import { prisma, withSystem } from "@/server/db";
import type { TenantContext } from "@/server/context";
import { effectivePermissions, type Role } from "@/domain/permissions";
import { todayIn } from "@/domain/dates";

export const hasDb = !!process.env.TEST_DATABASE_URL;

export async function makeBusiness(name = "Test Biz " + randomUUID().slice(0, 6)) {
  return withSystem(async (tx) => {
    const b = await tx.business.create({ data: { name, defaultCustomerCreditDays: 30 } });
    await tx.businessSettings.create({ data: { businessId: b.id, workingDays: [1, 2, 3, 4, 5, 6, 7], reminderStartHour: 0, reminderEndHour: 24 } });
    return b;
  });
}

export async function makeUser(businessId: string, role: Role = "owner", permissions: string[] = []) {
  const user = await prisma.user.create({ data: { email: `u${randomUUID().slice(0, 8)}@example.test`, name: `User ${role}`, passwordHash: "x" } });
  await withSystem((tx) => tx.membership.create({ data: { businessId, userId: user.id, role, permissions } }));
  return user;
}

export function ctxFor(business: { id: string; name: string; timezone?: string }, user: { id: string; name: string; email: string }, role: Role = "owner", permissions: string[] = [], today?: string): TenantContext {
  const tz = business.timezone ?? "Asia/Kolkata";
  return {
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
    sessionId: randomUUID(),
    businessId: business.id,
    businessName: business.name,
    timezone: tz,
    isDemo: false,
    role,
    permissions: effectivePermissions(role, permissions),
    memberships: [{ businessId: business.id, businessName: business.name, role }],
    today: today ?? todayIn(tz),
  };
}

export async function setup(role: Role = "owner") {
  const business = await makeBusiness();
  const user = await makeUser(business.id, role);
  return { business, user, ctx: ctxFor(business, user, role) };
}
