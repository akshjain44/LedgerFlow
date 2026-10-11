import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "../db";
import { AppError } from "../errors";

const WINDOW_MINUTES = 15;
const LIMITS: Record<string, number> = { login: 8, reset: 5, signup: 10 };

function keyHash(key: string) {
  return createHash("sha256").update(key.toLowerCase()).digest("hex");
}

/** Throws if too many failed attempts were made for this key recently. Stores only a hash of the key. */
export async function assertNotRateLimited(kind: keyof typeof LIMITS, key: string) {
  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000);
  const count = await prisma.authAttempt.count({ where: { kind, keyHash: keyHash(key), success: false, createdAt: { gte: since } } });
  if (count >= LIMITS[kind]) {
    throw new AppError(`Too many attempts. Please wait ${WINDOW_MINUTES} minutes and try again.`);
  }
}

export async function recordAttempt(kind: keyof typeof LIMITS, key: string, success: boolean) {
  await prisma.authAttempt.create({ data: { kind, keyHash: keyHash(key), success } });
}
