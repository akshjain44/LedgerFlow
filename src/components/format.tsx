import { formatINR, formatINRCompact, type Paise } from "@/domain/money";
import { formatDate, formatDateTime } from "@/domain/dates";
import type { DisplayStatus } from "@/domain/invoiceStatus";
import { Badge, type Tone } from "./ui";
import { cn } from "@/lib/cn";

export function Money({ value, compact, className, tone }: { value: Paise | null | undefined; compact?: boolean; className?: string; tone?: "auto" | "bad" | "ok" | "muted" }) {
  if (value === null || value === undefined) return <span className="text-muted">—</span>;
  return (
    <span className={cn("num whitespace-nowrap", tone === "bad" && value > 0n && "text-bad", tone === "ok" && "text-ok", tone === "muted" && "text-muted", className)} title={compact ? formatINR(value) : undefined}>
      {compact ? formatINRCompact(value) : formatINR(value)}
    </span>
  );
}

export function DateText({ value, className }: { value: string | Date | null | undefined; className?: string }) {
  return <span className={cn("whitespace-nowrap", className)}>{formatDate(value ?? null)}</span>;
}

export function DateTimeText({ value, tz }: { value: Date | null | undefined; tz: string }) {
  return <span className="whitespace-nowrap">{formatDateTime(value ?? null, tz)}</span>;
}

const STATUS: Record<DisplayStatus, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  void: { label: "Void", tone: "neutral" },
  paid: { label: "Paid", tone: "ok" },
  overdue: { label: "Overdue", tone: "bad" },
  due_today: { label: "Due today", tone: "warn" },
  partially_paid: { label: "Partially paid", tone: "accent" },
  open: { label: "Open", tone: "info" },
};

export function StatusBadge({ status, partiallyPaid }: { status: DisplayStatus; partiallyPaid?: boolean }) {
  const s = STATUS[status];
  return (
    <span className="inline-flex flex-wrap gap-1">
      <Badge tone={s.tone}>{s.label}</Badge>
      {partiallyPaid && (status === "overdue" || status === "due_today") && <Badge tone="accent">Part-paid</Badge>}
    </span>
  );
}

/** "12 days overdue" / "Due today" / "in 5 days". */
export function DaysLabel({ days }: { days: number | null }) {
  if (days === null) return <span className="text-muted">—</span>;
  if (days > 0) return <span className="font-medium text-bad whitespace-nowrap">{days}d overdue</span>;
  if (days === 0) return <span className="font-medium text-warn whitespace-nowrap">Due today</span>;
  return <span className="text-muted whitespace-nowrap">in {-days}d</span>;
}

export const PROMISE_TONE: Record<string, Tone> = { upcoming: "accent", kept: "ok", partially_kept: "warn", broken: "bad", cancelled: "neutral" };
export const PROMISE_LABEL: Record<string, string> = { upcoming: "Upcoming", kept: "Kept", partially_kept: "Partially kept", broken: "Broken", cancelled: "Cancelled" };

export function PromiseBadge({ status, date, today }: { status: string; date?: string; today?: string }) {
  const dueToday = status === "upcoming" && date && today && date === today;
  const overdueReview = status === "upcoming" && date && today && date < today;
  return <Badge tone={dueToday ? "warn" : PROMISE_TONE[status] ?? "neutral"}>{dueToday ? "Due today" : overdueReview ? "Awaiting payment" : PROMISE_LABEL[status] ?? status}</Badge>;
}

export const PRIORITY_TONE: Record<string, Tone> = { critical: "bad", high: "warn", medium: "accent", low: "neutral", urgent: "bad", normal: "neutral" };
