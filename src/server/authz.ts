import type { Permission, Role } from "@/domain/permissions";
import { ForbiddenError } from "./errors";

/** Resolved per request by context.ts; services receive it explicitly. */
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

export function can(ctx: Pick<TenantContext, "permissions">, permission: Permission): boolean {
  return ctx.permissions.has(permission);
}

/** Server-side authorization check used by every service mutation and query. */
export function assertCan(ctx: Pick<TenantContext, "permissions">, permission: Permission) {
  if (!ctx.permissions.has(permission)) throw new ForbiddenError();
}
