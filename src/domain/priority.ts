import { diffDays, type ISODate } from "./dates";
import type { Paise } from "./money";

/**
 * Transparent, rule-based collections priority. Every point added comes with
 * a human-readable reason so staff can see why an account is ranked where it
 * is. Weights are configurable per business (business_settings.priority_weights).
 */
export interface PriorityWeights {
  overdue1to7: number;
  overdue8to30: number;
  overdue31to60: number;
  overdue61to90: number;
  overdue90plus: number;
  amount25k: number;
  amount1L: number;
  amount5L: number;
  promiseDueToday: number;
  brokenPromise: number;
  perPriorBrokenPromise: number;
  neverContacted: number;
  noContact7Days: number;
  noContact14Days: number;
  followUpDueOrMissed: number;
  followUpScheduled: number;
  openDispute: number;
  disputeHold: number;
  dueToday: number;
}

export const DEFAULT_PRIORITY_WEIGHTS: PriorityWeights = {
  overdue1to7: 10,
  overdue8to30: 20,
  overdue31to60: 30,
  overdue61to90: 40,
  overdue90plus: 50,
  amount25k: 5,
  amount1L: 10,
  amount5L: 15,
  promiseDueToday: 25,
  brokenPromise: 30,
  perPriorBrokenPromise: 10,
  neverContacted: 25,
  noContact7Days: 10,
  noContact14Days: 15,
  followUpDueOrMissed: 20,
  followUpScheduled: -15,
  openDispute: -5,
  disputeHold: -40,
  dueToday: 8,
};

export interface AccountSignals {
  today: ISODate;
  maxDaysOverdue: number | null; // null when nothing is overdue
  overdueAmount: Paise;
  outstanding: Paise;
  hasDueToday: boolean;
  promiseDueToday: boolean;
  /** Broken promise with no newer promise or payment since. */
  unresolvedBrokenPromise: boolean;
  brokenPromisesInWindow: number;
  lastContactDate: ISODate | null;
  /** First date any currently-open invoice became overdue. */
  overdueSince: ISODate | null;
  openDispute: boolean;
  disputeHold: boolean;
  nextFollowUpDate: ISODate | null;
}

export interface PriorityResult {
  score: number;
  reasons: { points: number; text: string }[];
  recommendedAction: string;
  band: "critical" | "high" | "medium" | "low";
}

export function mergeWeights(overrides: unknown): PriorityWeights {
  const w = { ...DEFAULT_PRIORITY_WEIGHTS };
  if (overrides && typeof overrides === "object") {
    for (const [k, v] of Object.entries(overrides as Record<string, unknown>)) {
      if (k in w && typeof v === "number" && Number.isFinite(v)) (w as Record<string, number>)[k] = v;
    }
  }
  return w;
}

const L = 100n * 100_000n; // ₹1 lakh in paise

export function scoreAccount(s: AccountSignals, w: PriorityWeights = DEFAULT_PRIORITY_WEIGHTS): PriorityResult {
  const reasons: { points: number; text: string }[] = [];
  const add = (points: number, text: string) => {
    if (points !== 0) reasons.push({ points, text });
  };

  const d = s.maxDaysOverdue;
  if (d !== null && d > 0) {
    if (d > 90) add(w.overdue90plus, `Oldest invoice ${d} days overdue (90+)`);
    else if (d > 60) add(w.overdue61to90, `Oldest invoice ${d} days overdue (61–90)`);
    else if (d > 30) add(w.overdue31to60, `Oldest invoice ${d} days overdue (31–60)`);
    else if (d > 7) add(w.overdue8to30, `Oldest invoice ${d} days overdue`);
    else add(w.overdue1to7, `Invoice ${d} day${d === 1 ? "" : "s"} overdue`);
  } else if (s.hasDueToday) {
    add(w.dueToday, "Invoice due today");
  }

  const exposure = s.overdueAmount > 0n ? s.overdueAmount : s.outstanding;
  if (exposure >= 5n * L) add(w.amount5L, "Overdue balance ≥ ₹5 lakh");
  else if (exposure >= L) add(w.amount1L, "Overdue balance ≥ ₹1 lakh");
  else if (exposure >= 25_000n * 100n) add(w.amount25k, "Overdue balance ≥ ₹25,000");

  if (s.promiseDueToday) add(w.promiseDueToday, "Promised payment due today");
  if (s.unresolvedBrokenPromise) add(w.brokenPromise, "Latest payment promise was broken");
  const prior = Math.max(0, s.brokenPromisesInWindow - (s.unresolvedBrokenPromise ? 1 : 0));
  if (prior > 0) add(Math.min(prior, 3) * w.perPriorBrokenPromise, `${prior} earlier broken promise${prior === 1 ? "" : "s"} in the review window`);

  const overdue = d !== null && d > 0;
  if (overdue) {
    const contactedSinceOverdue = s.lastContactDate !== null && s.overdueSince !== null && s.lastContactDate >= s.overdueSince;
    if (!contactedSinceOverdue) {
      add(w.neverContacted, s.lastContactDate === null ? "Never contacted" : "Not contacted since becoming overdue");
    } else {
      const since = diffDays(s.lastContactDate!, s.today);
      if (since > 14) add(w.noContact14Days, `No contact for ${since} days`);
      else if (since > 7) add(w.noContact7Days, `No contact for ${since} days`);
    }
  }

  if (s.nextFollowUpDate !== null) {
    if (s.nextFollowUpDate <= s.today) add(w.followUpDueOrMissed, s.nextFollowUpDate < s.today ? "Scheduled follow-up missed" : "Follow-up scheduled for today");
    else add(w.followUpScheduled, "Follow-up already scheduled");
  }

  if (s.disputeHold) add(w.disputeHold, "Collections on hold pending dispute (documented)");
  else if (s.openDispute) add(w.openDispute, "Open dispute — resolve evidence before pressing for payment");

  const score = reasons.reduce((a, r) => a + r.points, 0);
  const band = score >= 70 ? "critical" : score >= 45 ? "high" : score >= 20 ? "medium" : "low";

  let recommendedAction = "Monitor";
  if (s.disputeHold) recommendedAction = "Work the dispute to resolution";
  else if (s.unresolvedBrokenPromise && s.brokenPromisesInWindow >= 2) recommendedAction = "Owner review: repeated broken promises";
  else if (s.unresolvedBrokenPromise) recommendedAction = "Call about the broken promise and get a new date";
  else if (s.promiseDueToday) recommendedAction = "Confirm today's promised payment";
  else if (s.openDispute) recommendedAction = "Share invoice/delivery evidence to resolve dispute";
  else if (overdue && reasons.some((r) => r.text.startsWith("Never") || r.text.startsWith("Not contacted"))) recommendedAction = "Call now — first contact";
  else if (s.nextFollowUpDate !== null && s.nextFollowUpDate <= s.today) recommendedAction = "Complete the scheduled follow-up";
  else if (overdue) recommendedAction = "Call to follow up on overdue balance";
  else if (s.hasDueToday) recommendedAction = "Courtesy reminder: due today";

  return { score, reasons: reasons.sort((a, b) => b.points - a.points), recommendedAction, band };
}
