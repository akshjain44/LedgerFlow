/**
 * Money is represented as integer paise in a `bigint`. Amounts enter and leave
 * the system as decimal strings ("12345.67") or Prisma Decimals; floats are
 * never used for authoritative arithmetic.
 *
 * Currency policy: INR amounts carry exactly two decimal places. Input with
 * more than two decimals is rejected rather than silently rounded.
 */
export type Paise = bigint;

const AMOUNT_RE = /^-?\d{1,12}(\.\d{1,2})?$/;

export class MoneyParseError extends Error {}

/** Parses "1,23,456.7", "₹ 500", "500.00". Throws MoneyParseError on bad input. */
export function parseAmount(input: string | number | { toString(): string } | null | undefined): Paise {
  if (input === null || input === undefined) throw new MoneyParseError("Amount is required");
  if (typeof input === "number") {
    if (!Number.isFinite(input)) throw new MoneyParseError("Amount must be a finite number");
    // Numbers only arrive from trusted internal callers; normalise via fixed.
    input = input.toFixed(2);
  }
  const cleaned = String(input).replace(/[₹,\s]/g, "").replace(/^INR/i, "");
  if (cleaned === "") throw new MoneyParseError("Amount is required");
  if (!AMOUNT_RE.test(cleaned)) throw new MoneyParseError("Enter an amount with at most two decimal places");
  const negative = cleaned.startsWith("-");
  const [whole, frac = ""] = cleaned.replace("-", "").split(".");
  const paise = BigInt(whole) * 100n + BigInt((frac + "00").slice(0, 2));
  return negative ? -paise : paise;
}

export function tryParseAmount(input: unknown): Paise | null {
  try {
    return parseAmount(input as string);
  } catch {
    return null;
  }
}

/** Decimal string with two places, suitable for NUMERIC(14,2) columns. */
export function toDecimalString(p: Paise): string {
  const negative = p < 0n;
  const abs = negative ? -p : p;
  const whole = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

/** Converts a Prisma Decimal / numeric string to paise. */
export function fromDecimal(d: { toString(): string } | string | null | undefined): Paise {
  if (d === null || d === undefined) return 0n;
  return parseAmount(d.toString());
}

/** Indian digit grouping: 12,34,567.89 */
function groupIndian(whole: string): string {
  if (whole.length <= 3) return whole;
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3);
  return rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3;
}

export function formatINR(p: Paise, opts: { symbol?: boolean; decimals?: boolean } = {}): string {
  const { symbol = true, decimals = true } = opts;
  const negative = p < 0n;
  const abs = negative ? -p : p;
  const whole = groupIndian((abs / 100n).toString());
  const frac = (abs % 100n).toString().padStart(2, "0");
  const body = decimals ? `${whole}.${frac}` : whole;
  return `${negative ? "−" : ""}${symbol ? "₹" : ""}${body}`;
}

/** Compact form for dashboard tiles: ₹4.2L, ₹1.3Cr. Display only. */
export function formatINRCompact(p: Paise): string {
  const negative = p < 0n;
  const abs = negative ? -p : p;
  const rupees = abs / 100n;
  const sign = negative ? "−" : "";
  const fmt = (scaled: bigint, unit: string) => {
    // one decimal place, truncated toward zero, computed in integers
    const whole = scaled / 10n;
    const tenth = scaled % 10n;
    return `${sign}₹${whole}${tenth === 0n ? "" : "." + tenth}${unit}`;
  };
  if (rupees >= 10_000_000n) return fmt((rupees * 10n) / 10_000_000n, "Cr");
  if (rupees >= 100_000n) return fmt((rupees * 10n) / 100_000n, "L");
  return formatINR(p, { decimals: false });
}

export const sum = (values: Paise[]): Paise => values.reduce((a, b) => a + b, 0n);
export const min = (a: Paise, b: Paise): Paise => (a < b ? a : b);
export const max = (a: Paise, b: Paise): Paise => (a > b ? a : b);

/** Ratio as a number for display (percentages). Returns null for a zero denominator. */
export function ratio(numerator: Paise | number, denominator: Paise | number): number | null {
  const d = typeof denominator === "bigint" ? Number(denominator) : denominator;
  const n = typeof numerator === "bigint" ? Number(numerator) : numerator;
  if (d === 0) return null;
  return n / d;
}
