import "server-only";
import type { Prisma } from "@prisma/client";
import type { Tx } from "./db";

export interface AuditInput {
  businessId: string;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  summary?: string;
  before?: unknown;
  after?: unknown;
}

const SENSITIVE = /password|token|secret|hash/i;

/** Serialises values for the audit log: Decimals/Dates/BigInts to strings; drops sensitive keys. */
function clean(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(
    JSON.stringify(value, (key, v) => {
      if (key && SENSITIVE.test(key)) return undefined;
      if (typeof v === "bigint") return v.toString();
      return v;
    }),
  );
}

export async function audit(tx: Tx, input: AuditInput) {
  await tx.auditLog.create({
    data: {
      businessId: input.businessId,
      actorUserId: input.actorUserId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      summary: input.summary,
      before: clean(input.before),
      after: clean(input.after),
    },
  });
}

/** Returns only the keys whose values differ, for compact before/after records. */
export function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>) {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    const bv = before[key];
    const av = after[key];
    const norm = (v: unknown) => (v instanceof Date ? v.toISOString() : v === undefined ? null : v?.toString?.() ?? v);
    if (norm(bv) !== norm(av)) {
      b[key] = bv;
      a[key] = av;
    }
  }
  return { before: b, after: a, changed: Object.keys(a) };
}
