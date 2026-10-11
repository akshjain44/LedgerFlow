import "server-only";
import type { NotificationPriority } from "@prisma/client";
import { withTenant, type Tx } from "../db";
import type { TenantContext } from "../authz";

export interface NotifyInput {
  businessId: string;
  userId: string;
  category: string;
  priority?: NotificationPriority;
  title: string;
  body?: string;
  link?: string;
  entityType?: string;
  entityId?: string | null;
  dedupeKey?: string;
}

/** Creates an in-app notification. With a dedupeKey it is created at most once per user. */
export async function notify(tx: Tx, n: NotifyInput) {
  if (n.dedupeKey) {
    const existing = await tx.notification.findUnique({ where: { businessId_userId_dedupeKey: { businessId: n.businessId, userId: n.userId, dedupeKey: n.dedupeKey } } });
    if (existing) return { notification: existing, created: false };
  }
  const notification = await tx.notification.create({
    data: {
      businessId: n.businessId,
      userId: n.userId,
      category: n.category,
      priority: n.priority ?? "normal",
      title: n.title,
      body: n.body,
      link: n.link,
      entityType: n.entityType,
      entityId: n.entityId ?? null,
      dedupeKey: n.dedupeKey ?? null,
    },
  });
  return { notification, created: true };
}

export async function unreadCount(ctx: TenantContext) {
  return withTenant(ctx.businessId, (tx) => tx.notification.count({ where: { userId: ctx.userId, readAt: null } }));
}

export async function markRead(ctx: TenantContext, id: string) {
  return withTenant(ctx.businessId, (tx) => tx.notification.updateMany({ where: { id, userId: ctx.userId, readAt: null }, data: { readAt: new Date() } }));
}

export async function markAllRead(ctx: TenantContext) {
  return withTenant(ctx.businessId, (tx) => tx.notification.updateMany({ where: { userId: ctx.userId, readAt: null }, data: { readAt: new Date() } }));
}
