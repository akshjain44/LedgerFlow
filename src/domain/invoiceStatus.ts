import { addDays, diffDays, type ISODate } from "./dates";
import type { Paise } from "./money";

/**
 * Invoice state is a set of independent facts, not one exclusive label:
 * an invoice can be partially paid AND overdue AND disputed at once.
 *
 * - lifecycle: draft | open | void (stored)
 * - settlement: unpaid | partially_paid | paid (derived from amounts)
 * - timing: not_due | due_today | overdue (derived from due date + balance)
 * - disputed: any dispute not yet resolved/closed (derived from disputes)
 */
export type Lifecycle = "draft" | "open" | "void";
export type Settlement = "unpaid" | "partially_paid" | "paid";
export type Timing = "not_due" | "due_today" | "overdue" | "settled";

export interface InvoiceFacts {
  lifecycle: Lifecycle;
  total: Paise;
  paid: Paise;
  adjusted: Paise;
  dueDate: ISODate;
}

export function outstanding(f: Pick<InvoiceFacts, "total" | "paid" | "adjusted">): Paise {
  return f.total - f.paid - f.adjusted;
}

export function settlement(f: InvoiceFacts): Settlement {
  const out = outstanding(f);
  if (out <= 0n) return "paid";
  if (f.paid > 0n || f.adjusted > 0n) return "partially_paid";
  return "unpaid";
}

/** An invoice is overdue when a positive balance remains and the due date is before today. Due today is not overdue. */
export function timing(f: InvoiceFacts, today: ISODate): Timing {
  if (f.lifecycle !== "open" || outstanding(f) <= 0n) return "settled";
  if (f.dueDate < today) return "overdue";
  if (f.dueDate === today) return "due_today";
  return "not_due";
}

export function isOverdue(f: InvoiceFacts, today: ISODate): boolean {
  return timing(f, today) === "overdue";
}

/** Positive = days past due, 0 = due today, negative = days remaining. */
export function daysPastDue(dueDate: ISODate, today: ISODate): number {
  return diffDays(dueDate, today);
}

export type DisplayStatus = "draft" | "void" | "paid" | "overdue" | "due_today" | "partially_paid" | "open";

/** Primary badge for tables. Disputes are shown as an additional badge, never instead of this. */
export function displayStatus(f: InvoiceFacts, today: ISODate): DisplayStatus {
  if (f.lifecycle === "draft") return "draft";
  if (f.lifecycle === "void") return "void";
  const s = settlement(f);
  if (s === "paid") return "paid";
  const t = timing(f, today);
  if (t === "overdue") return "overdue";
  if (t === "due_today") return "due_today";
  if (s === "partially_paid") return "partially_paid";
  return "open";
}

/** Due date from invoice date + credit days. */
export function computeDueDate(invoiceDate: ISODate, creditDays: number): ISODate {
  return addDays(invoiceDate, creditDays);
}
