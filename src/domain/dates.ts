/**
 * Business calendar dates are ISO strings "YYYY-MM-DD" in the business's
 * timezone. DATE columns arrive from Prisma as JS Dates at UTC midnight;
 * `fromDbDate` / `toDbDate` convert without timezone drift.
 */
export type ISODate = string;

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function isISODate(s: unknown): s is ISODate {
  return validIso(s);
}

function validIso(s: unknown): boolean {
  if (typeof s !== "string" || !ISO_RE.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Today's calendar date in the given IANA timezone. */
export function todayIn(timezone: string, now: Date = new Date()): ISODate {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Local hour (0-23) and ISO weekday (1=Mon..7=Sun) in the timezone. */
export function localClock(timezone: string, now: Date = new Date()): { hour: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(wd) + 1;
  return { hour, weekday };
}

export function addDays(date: ISODate, days: number): ISODate {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (b - a). */
export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86_400_000);
}

export function isoWeekday(date: ISODate): number {
  const day = new Date(date + "T00:00:00Z").getUTCDay();
  return day === 0 ? 7 : day;
}

export function fromDbDate(d: Date): ISODate;
export function fromDbDate(d: Date | null | undefined): ISODate | null;
export function fromDbDate(d: Date | null | undefined): ISODate | null {
  if (!d) return null;
  return d.toISOString().slice(0, 10);
}

export function toDbDate(date: ISODate): Date {
  if (!isISODate(date)) throw new Error(`Invalid date: ${date}`);
  return new Date(date + "T00:00:00Z");
}

/** "07 Oct 2026" */
export function formatDate(date: ISODate | Date | null | undefined): string {
  if (!date) return "—";
  const iso = typeof date === "string" ? date : date.toISOString().slice(0, 10);
  const [y, m, d] = iso.split("-");
  return `${d} ${MONTHS[Number(m) - 1]} ${y}`;
}

/** "07 Oct 2026, 14:05" in the business timezone. */
export function formatDateTime(instant: Date | null | undefined, timezone: string): string {
  if (!instant) return "—";
  const date = todayIn(timezone, instant);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(instant);
  return `${formatDate(date)}, ${time}`;
}

export function startOfMonth(date: ISODate): ISODate {
  return date.slice(0, 8) + "01";
}

export function endOfMonth(date: ISODate): ISODate {
  const [y, m] = date.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  return d.toISOString().slice(0, 10);
}

/** Converts "DD/MM/YYYY", "DD-MM-YYYY", "YYYY-MM-DD" or "07 Oct 2026" to ISO. Returns null if ambiguous or invalid. */
export function parseFlexibleDate(input: string): ISODate | null {
  const s = input.trim();
  if (validIso(s)) return s;
  let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) {
    const iso = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    return isISODate(iso) ? iso : null;
  }
  m = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3})[A-Za-z]*[\s-](\d{4})$/);
  if (m) {
    const mi = MONTHS.findIndex((x) => x.toLowerCase() === m![2].toLowerCase());
    if (mi < 0) return null;
    const iso = `${m[3]}-${String(mi + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    return isISODate(iso) ? iso : null;
  }
  return null;
}

/** The instant at which `date` begins in `timezone` (for filtering TIMESTAMPTZ columns by business-local day). */
export function zonedStartOfDay(date: ISODate, timezone: string): Date {
  const utcGuess = new Date(date + "T00:00:00Z");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(utcGuess);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return new Date(utcGuess.getTime() - (asUtc - utcGuess.getTime()));
}
