import "server-only";
import { Prisma, PrismaClient } from "@prisma/client";

declare global {
  var __ledgerflowPrisma: PrismaClient | undefined;
}

/**
 * Connects as the restricted `ledgerflow_app` role (DATABASE_URL). Tenant
 * tables are protected by Row Level Security: outside `withTenant` /
 * `withSystem` they return no rows.
 */
export const prisma: PrismaClient =
  globalThis.__ledgerflowPrisma ?? new PrismaClient({ log: process.env.PRISMA_LOG === "1" ? ["query", "warn", "error"] : ["warn", "error"] });

if (process.env.NODE_ENV !== "production") globalThis.__ledgerflowPrisma = prisma;

export type Tx = Prisma.TransactionClient;

const TX_OPTIONS = { timeout: 30_000, maxWait: 10_000 } as const;

/** Runs `fn` in a transaction scoped to one business. RLS enforces the scope in the database. */
export async function withTenant<T>(businessId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!/^[0-9a-f-]{36}$/i.test(businessId)) throw new Error("Invalid business id");
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.business_id', ${businessId}, true)`;
    return fn(tx);
  }, TX_OPTIONS);
}

/**
 * Cross-tenant access for trusted system processes only (reminder processor,
 * invitation acceptance, onboarding, demo seeding). Never call from a code
 * path that takes a business id from the browser without a membership check.
 */
export async function withSystem<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
    return fn(tx);
  }, TX_OPTIONS);
}
