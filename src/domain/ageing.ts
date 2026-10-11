import { diffDays, type ISODate } from "./dates";
import type { Paise } from "./money";

export type AgeingBucket = "not_due" | "due_today" | "d1_30" | "d31_60" | "d61_90" | "d90_plus";

export const AGEING_BUCKETS: { key: AgeingBucket; label: string; overdue: boolean }[] = [
  { key: "not_due", label: "Not yet due", overdue: false },
  { key: "due_today", label: "Due today", overdue: false },
  { key: "d1_30", label: "1–30 days", overdue: true },
  { key: "d31_60", label: "31–60 days", overdue: true },
  { key: "d61_90", label: "61–90 days", overdue: true },
  { key: "d90_plus", label: "90+ days", overdue: true },
];

export function ageingBucket(dueDate: ISODate, asOf: ISODate): AgeingBucket {
  const days = diffDays(dueDate, asOf);
  if (days < 0) return "not_due";
  if (days === 0) return "due_today";
  if (days <= 30) return "d1_30";
  if (days <= 60) return "d31_60";
  if (days <= 90) return "d61_90";
  return "d90_plus";
}

export type AgeingTotals = Record<AgeingBucket, Paise> & { total: Paise; overdue: Paise };

export function emptyAgeing(): AgeingTotals {
  return { not_due: 0n, due_today: 0n, d1_30: 0n, d31_60: 0n, d61_90: 0n, d90_plus: 0n, total: 0n, overdue: 0n };
}

export function addToAgeing(t: AgeingTotals, dueDate: ISODate, asOf: ISODate, amount: Paise): AgeingTotals {
  if (amount <= 0n) return t;
  const b = ageingBucket(dueDate, asOf);
  t[b] += amount;
  t.total += amount;
  if (AGEING_BUCKETS.find((x) => x.key === b)!.overdue) t.overdue += amount;
  return t;
}
