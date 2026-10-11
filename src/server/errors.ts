import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { AllocationError } from "@/domain/allocation";
import { MoneyParseError } from "@/domain/money";

/** An error whose message is safe and useful to show the user. */
export class AppError extends Error {
  constructor(message: string, public fieldErrors?: Record<string, string>) {
    super(message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to do that.") {
    super(message);
  }
}

export class NotFoundError extends AppError {
  constructor(what = "Record") {
    super(`${what} not found.`);
  }
}

export type ActionResult<T = undefined> =
  | { ok: true; message?: string; data?: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export function zodFieldErrors(e: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of e.issues) {
    const key = issue.path.join(".") || "_form";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

/** Converts any thrown error into a user-safe ActionResult. Unexpected errors are logged without request payloads. */
export function toActionError(e: unknown): { ok: false; error: string; fieldErrors?: Record<string, string> } {
  if (e instanceof AppError) return { ok: false, error: e.message, fieldErrors: e.fieldErrors };
  if (e instanceof ZodError) return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: zodFieldErrors(e) };
  if (e instanceof AllocationError || e instanceof MoneyParseError) return { ok: false, error: e.message };
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === "P2002") return { ok: false, error: "A record with the same unique value already exists." };
    if (e.code === "P2025") return { ok: false, error: "The record no longer exists." };
  }
  const msg = e instanceof Error ? e.message : String(e);
  // Database integrity triggers raise check_violation with a readable message.
  const dbMatch = msg.match(/(?:ERROR|error):\s*([^\n]+?)(?:\n|$)/);
  if (msg.includes("check_violation") || msg.includes("violates check constraint") || /cannot|must|exceed|reject/i.test(dbMatch?.[1] ?? "")) {
    console.error("[ledgerflow] integrity rejection:", dbMatch?.[1] ?? msg.slice(0, 300));
    return { ok: false, error: `The database rejected this change: ${dbMatch?.[1] ?? "integrity rule violated"}` };
  }
  console.error("[ledgerflow] unexpected error:", e instanceof Error ? `${e.name}: ${e.message.slice(0, 500)}` : "non-error thrown");
  return { ok: false, error: "Something went wrong. Nothing was saved — please try again." };
}
