import type { Paise } from "./money";

export interface AllocationTarget {
  invoiceId: string;
  outstanding: Paise;
  dueDate: string;
}

export interface AllocationRequest {
  invoiceId: string;
  amount: Paise;
}

export class AllocationError extends Error {}

/**
 * Validates a set of allocations for one payment. Rules:
 * - each amount > 0
 * - no invoice listed twice
 * - each allocation ≤ that invoice's outstanding balance
 * - total ≤ the payment's unallocated amount
 * Returns the unallocated remainder.
 */
export function validateAllocations(
  available: Paise,
  requests: AllocationRequest[],
  targets: Map<string, AllocationTarget>,
): Paise {
  const seen = new Set<string>();
  let total = 0n;
  for (const r of requests) {
    if (r.amount <= 0n) throw new AllocationError("Allocation amounts must be greater than zero");
    if (seen.has(r.invoiceId)) throw new AllocationError("An invoice appears more than once in the allocation");
    seen.add(r.invoiceId);
    const t = targets.get(r.invoiceId);
    if (!t) throw new AllocationError("Allocation refers to an invoice that is not open for this counterparty");
    if (r.amount > t.outstanding) throw new AllocationError("Allocation exceeds the invoice's outstanding balance");
    total += r.amount;
  }
  if (total > available) throw new AllocationError("Allocations exceed the payment's unallocated amount");
  return available - total;
}

/** Suggests allocations oldest-due-first. Used to pre-fill the form; the user confirms. */
export function suggestAllocations(available: Paise, targets: AllocationTarget[]): AllocationRequest[] {
  const sorted = [...targets].sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
  const result: AllocationRequest[] = [];
  let remaining = available;
  for (const t of sorted) {
    if (remaining <= 0n) break;
    if (t.outstanding <= 0n) continue;
    const amount = t.outstanding < remaining ? t.outstanding : remaining;
    result.push({ invoiceId: t.invoiceId, amount });
    remaining -= amount;
  }
  return result;
}
