import "server-only";
import { revalidatePath } from "next/cache";
import { tenantOrThrow, type TenantContext } from "@/server/context";
import { toActionError, type ActionResult } from "@/server/errors";
import type { Permission } from "@/domain/permissions";

/** Shared wrapper: resolves the tenant on the server, runs the mutation, maps errors to user-safe results. */
export async function run<T>(
  fn: (ctx: TenantContext) => Promise<T>,
  opts: { message?: string | ((r: T) => string); redirect?: string | ((r: T) => string); permission?: Permission } = {},
): Promise<ActionResult<{ redirect?: string; result?: unknown }>> {
  try {
    const ctx = await tenantOrThrow(opts.permission);
    const r = await fn(ctx);
    revalidatePath("/", "layout");
    return {
      ok: true,
      message: typeof opts.message === "function" ? opts.message(r) : opts.message,
      data: { redirect: typeof opts.redirect === "function" ? opts.redirect(r) : opts.redirect, result: r && typeof r === "object" && "link" in (r as object) ? r : undefined },
    };
  } catch (e) {
    return toActionError(e);
  }
}

export function fields(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string" && !(k in out)) out[k] = v;
  return out;
}

export function list(fd: FormData, key: string): string[] {
  return fd.getAll(key).filter((v): v is string => typeof v === "string" && v !== "");
}

export function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}
