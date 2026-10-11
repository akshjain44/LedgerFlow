import { addDays, diffDays, type ISODate } from "./dates";

export type ReminderType =
  | "receivable_upcoming"
  | "receivable_due_today"
  | "receivable_overdue"
  | "promise_due_today"
  | "promise_broken"
  | "promise_repeated_broken"
  | "followup_due"
  | "payable_upcoming"
  | "payable_overdue"
  | "planned_payment_due"
  | "dispute_review"
  | "delivery_failure";

export const REMINDER_LABELS: Record<ReminderType, string> = {
  receivable_upcoming: "Receivable due soon",
  receivable_due_today: "Receivable due today",
  receivable_overdue: "Receivable overdue",
  promise_due_today: "Promise-to-pay due today",
  promise_broken: "Payment promise broken",
  promise_repeated_broken: "Repeated broken promises",
  followup_due: "Scheduled follow-up",
  payable_upcoming: "Supplier payment due soon",
  payable_overdue: "Supplier bill overdue",
  planned_payment_due: "Planned supplier payment due",
  dispute_review: "Dispute needs review",
  delivery_failure: "Reminder delivery failed",
};

/** How many days late a missed reminder may still be delivered (e.g. after a scheduler outage). Older ones are skipped as stale. */
export const CATCH_UP_DAYS = 2;

export interface ScheduledReminder {
  offset: number;
  scheduledFor: ISODate;
  type: ReminderType;
  dedupeKey: string;
}

export function reminderTypeFor(direction: "receivable" | "payable", offset: number): ReminderType {
  if (direction === "receivable") return offset < 0 ? "receivable_upcoming" : offset === 0 ? "receivable_due_today" : "receivable_overdue";
  return offset <= 0 ? "payable_upcoming" : "payable_overdue";
}

/**
 * The reminder schedule for one invoice: one entry per configured offset
 * (days relative to the due date) whose date is not already stale. The due
 * date is part of the dedupe key, so a due-date change produces a fresh
 * schedule and jobs keyed to the old date are cancelled as obsolete.
 */
export function buildInvoiceSchedule(
  direction: "receivable" | "payable",
  invoiceId: string,
  dueDate: ISODate,
  offsets: number[],
  today: ISODate,
): ScheduledReminder[] {
  return [...new Set(offsets)]
    .sort((a, b) => a - b)
    .map((offset) => ({ offset, scheduledFor: addDays(dueDate, offset) }))
    .filter((o) => diffDays(o.scheduledFor, today) <= CATCH_UP_DAYS)
    .map((o) => ({
      ...o,
      type: reminderTypeFor(direction, o.offset),
      dedupeKey: `${direction}:${invoiceId}:due:${dueDate}:offset:${o.offset}`,
    }));
}

export function isStale(scheduledFor: ISODate, today: ISODate): boolean {
  return diffDays(scheduledFor, today) > CATCH_UP_DAYS;
}

/** Bounded exponential backoff for transient delivery failures. */
export const MAX_DELIVERY_ATTEMPTS = 3;
export function nextRetryAt(attempts: number, now: Date): Date | null {
  if (attempts >= MAX_DELIVERY_ATTEMPTS) return null;
  const minutes = 5 * 2 ** (attempts - 1); // 5, 10, 20...
  return new Date(now.getTime() + minutes * 60_000);
}

export function withinWorkingHours(
  clock: { hour: number; weekday: number },
  settings: { workingDays: number[]; reminderStartHour: number; reminderEndHour: number },
): boolean {
  return settings.workingDays.includes(clock.weekday) && clock.hour >= settings.reminderStartHour && clock.hour < settings.reminderEndHour;
}
