import type { ISODate } from "./dates";
import type { Paise } from "./money";

export type PromiseOutcome = "upcoming" | "due_today" | "kept" | "partially_kept" | "broken";

export interface PromiseEvaluationInput {
  promisedDate: ISODate;
  amount: Paise;
  /** Payments allocated to the promise's invoices, dated from the day the promise was recorded through the promised date (inclusive). */
  receivedByPromisedDate: Paise;
  /** Payments received after the promised date (late), for review context. */
  receivedAfter: Paise;
  today: ISODate;
  /** Days after the promised date to wait for a payment to be recorded before calling it broken. */
  graceDays?: number;
}

export interface PromiseEvaluation {
  outcome: PromiseOutcome;
  received: Paise;
  shortfall: Paise;
  /** True where an authorised person should review (e.g. paid late, or partial). */
  needsReview: boolean;
  explanation: string;
}

/**
 * A promise is never marked kept just because its date passed. It is judged
 * against payments actually allocated to the promised invoices.
 */
export function evaluatePromise(input: PromiseEvaluationInput, addDaysFn: (d: ISODate, n: number) => ISODate): PromiseEvaluation {
  const { promisedDate, amount, receivedByPromisedDate: received, receivedAfter, today, graceDays = 0 } = input;
  const shortfall = amount > received ? amount - received : 0n;

  if (received >= amount) {
    return { outcome: "kept", received, shortfall: 0n, needsReview: false, explanation: "Payments allocated by the promised date cover the promised amount." };
  }
  if (today < promisedDate) {
    return { outcome: "upcoming", received, shortfall, needsReview: false, explanation: "Promised date has not arrived." };
  }
  const decisionDate = addDaysFn(promisedDate, graceDays);
  if (today <= decisionDate) {
    return { outcome: "due_today", received, shortfall, needsReview: false, explanation: "Promised payment is due; waiting for it to be recorded." };
  }
  if (received > 0n) {
    return {
      outcome: "partially_kept",
      received,
      shortfall,
      needsReview: true,
      explanation: "Part of the promised amount was received by the promised date; the remainder is outstanding.",
    };
  }
  return {
    outcome: "broken",
    received,
    shortfall,
    needsReview: receivedAfter > 0n,
    explanation:
      receivedAfter > 0n
        ? "No payment was recorded by the promised date; a later payment exists and may need review."
        : "No payment was recorded against the promised invoices by the promised date.",
  };
}

/** Escalate when broken promises within the window reach the threshold. */
export function shouldEscalate(brokenDatesInWindow: ISODate[], threshold: number): boolean {
  return brokenDatesInWindow.length >= threshold;
}
