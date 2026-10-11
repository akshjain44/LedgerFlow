import "server-only";
import type { Tx } from "../db";
import { fromDecimal, toDecimalString, type Paise } from "@/domain/money";
import { NotFoundError } from "../errors";
import { mergeWeights } from "@/domain/priority";

export const dec = (p: Paise) => toDecimalString(p);
export const paise = fromDecimal;

export async function loadSettings(tx: Tx, businessId: string) {
  const [business, settings] = await Promise.all([
    tx.business.findUniqueOrThrow({ where: { id: businessId } }),
    tx.businessSettings.findUnique({ where: { businessId } }),
  ]);
  const s =
    settings ??
    (await tx.businessSettings.create({ data: { businessId } }));
  return { business, settings: s, weights: mergeWeights(s.priorityWeights) };
}

export async function requireCounterparty(tx: Tx, id: string, role?: "customer" | "supplier") {
  const cp = await tx.counterparty.findUnique({ where: { id } });
  if (!cp) throw new NotFoundError(role === "supplier" ? "Supplier" : role === "customer" ? "Customer" : "Account");
  if (role === "customer" && !cp.isCustomer) throw new NotFoundError("Customer");
  if (role === "supplier" && !cp.isSupplier) throw new NotFoundError("Supplier");
  return cp;
}

/** Empty strings from forms become null. */
export function blankToNull(v: unknown): string | null {
  if (typeof v !== "string") return v == null ? null : String(v);
  const t = v.trim();
  return t === "" ? null : t;
}
