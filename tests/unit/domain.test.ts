import { describe, it, expect } from "vitest";
import { parseAmount, toDecimalString, formatINR, formatINRCompact, MoneyParseError, ratio } from "@/domain/money";
import { addDays, diffDays, formatDate, parseFlexibleDate, todayIn, isISODate, localClock, zonedStartOfDay } from "@/domain/dates";
import { displayStatus, outstanding, settlement, timing, computeDueDate, daysPastDue } from "@/domain/invoiceStatus";
import { ageingBucket, addToAgeing, emptyAgeing } from "@/domain/ageing";
import { validateAllocations, suggestAllocations, AllocationError } from "@/domain/allocation";
import { evaluatePromise, shouldEscalate } from "@/domain/promises";
import { scoreAccount, mergeWeights, DEFAULT_PRIORITY_WEIGHTS, type AccountSignals } from "@/domain/priority";
import { buildInvoiceSchedule, isStale, nextRetryAt, withinWorkingHours, reminderTypeFor, MAX_DELIVERY_ATTEMPTS } from "@/domain/reminderSchedule";
import { effectivePermissions } from "@/domain/permissions";
import { csvCell, toCsv } from "@/server/csv";

describe("money", () => {
  it("parses Indian formatted amounts into paise without floats", () => {
    expect(parseAmount("1,23,456.78")).toBe(12_345_678n);
    expect(parseAmount("₹ 50,000")).toBe(5_000_000n);
    expect(parseAmount("0.1")).toBe(10n);
    expect(parseAmount("-20.05")).toBe(-2005n);
    expect(parseAmount("999999999999.99")).toBe(99_999_999_999_999n);
  });
  it("rejects malformed amounts instead of rounding", () => {
    for (const bad of ["", "abc", "1.234", "1,2,3.4.5", "1e5", "12..5", null]) expect(() => parseAmount(bad as string)).toThrow(MoneyParseError);
  });
  it("adds decimal values exactly (no 0.1 + 0.2 drift)", () => {
    expect(toDecimalString(parseAmount("0.1") + parseAmount("0.2"))).toBe("0.30");
  });
  it("formats INR with lakh/crore grouping", () => {
    expect(formatINR(12_345_678n)).toBe("₹1,23,456.78");
    expect(formatINR(100n)).toBe("₹1.00");
    expect(formatINR(-5_000_000n)).toBe("−₹50,000.00");
    expect(formatINR(1_234_567_890n, { decimals: false })).toBe("₹1,23,45,678");
    expect(formatINRCompact(4_250_000_000n)).toBe("₹4.2Cr");
    expect(formatINRCompact(4_250_000_00n)).toBe("₹42.5L");
    expect(formatINRCompact(1_500_000_0n)).toBe("₹1.5L");
  });
  it("returns null ratios for zero denominators", () => {
    expect(ratio(5n, 0n)).toBeNull();
    expect(ratio(1, 4)).toBe(0.25);
  });
});

describe("dates", () => {
  it("computes business-local today in Asia/Kolkata", () => {
    // 2026-10-10T19:00Z is 00:30 on 11 Oct in India.
    expect(todayIn("Asia/Kolkata", new Date("2026-10-10T19:00:00Z"))).toBe("2026-10-11");
    expect(todayIn("Asia/Kolkata", new Date("2026-10-10T18:00:00Z"))).toBe("2026-10-10");
  });
  it("does calendar arithmetic across month/year/leap boundaries", () => {
    expect(addDays("2026-01-31", 30)).toBe("2026-03-02");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(diffDays("2026-10-01", "2026-10-11")).toBe(10);
  });
  it("parses DD/MM/YYYY, ISO and '07 Oct 2026' and rejects impossible dates", () => {
    expect(parseFlexibleDate("07/10/2026")).toBe("2026-10-07");
    expect(parseFlexibleDate("2026-10-07")).toBe("2026-10-07");
    expect(parseFlexibleDate("7 Oct 2026")).toBe("2026-10-07");
    expect(parseFlexibleDate("31/02/2026")).toBeNull();
    expect(parseFlexibleDate("2026-13-01")).toBeNull();
    expect(isISODate("2026-02-30")).toBe(false);
  });
  it("formats as DD MMM YYYY", () => {
    expect(formatDate("2026-10-07")).toBe("07 Oct 2026");
  });
  it("reads local clock and start of day in the business timezone", () => {
    expect(localClock("Asia/Kolkata", new Date("2026-10-11T03:30:00Z"))).toEqual({ hour: 9, weekday: 7 });
    expect(zonedStartOfDay("2026-10-11", "Asia/Kolkata").toISOString()).toBe("2026-10-10T18:30:00.000Z");
  });
});

describe("invoice status", () => {
  const base = { lifecycle: "open" as const, total: 5_000_000n, paid: 0n, adjusted: 0n, dueDate: "2026-10-11" };
  it("due today is not overdue; yesterday's due date is", () => {
    expect(timing(base, "2026-10-11")).toBe("due_today");
    expect(timing(base, "2026-10-12")).toBe("overdue");
    expect(timing(base, "2026-10-10")).toBe("not_due");
  });
  it("partially paid invoices can be overdue; settled ones never are", () => {
    const part = { ...base, paid: 2_000_000n };
    expect(outstanding(part)).toBe(3_000_000n);
    expect(settlement(part)).toBe("partially_paid");
    expect(displayStatus(part, "2026-10-20")).toBe("overdue");
    const paid = { ...base, paid: 5_000_000n };
    expect(displayStatus(paid, "2026-12-31")).toBe("paid");
    expect(timing(paid, "2026-12-31")).toBe("settled");
  });
  it("credit notes count toward settlement", () => {
    expect(displayStatus({ ...base, paid: 4_000_000n, adjusted: 1_000_000n }, "2026-12-31")).toBe("paid");
  });
  it("void and draft are never overdue", () => {
    expect(displayStatus({ ...base, lifecycle: "void" }, "2027-01-01")).toBe("void");
    expect(displayStatus({ ...base, lifecycle: "draft" }, "2027-01-01")).toBe("draft");
  });
  it("calculates due dates and days past due", () => {
    expect(computeDueDate("2026-09-11", 30)).toBe("2026-10-11");
    expect(daysPastDue("2026-10-01", "2026-10-11")).toBe(10);
  });
});

describe("ageing", () => {
  it("buckets by days past due with due-today separate", () => {
    const asOf = "2026-10-11";
    expect(ageingBucket("2026-10-12", asOf)).toBe("not_due");
    expect(ageingBucket("2026-10-11", asOf)).toBe("due_today");
    expect(ageingBucket("2026-10-10", asOf)).toBe("d1_30");
    expect(ageingBucket("2026-09-11", asOf)).toBe("d1_30");
    expect(ageingBucket("2026-09-10", asOf)).toBe("d31_60");
    expect(ageingBucket("2026-08-12", asOf)).toBe("d31_60");
    expect(ageingBucket("2026-08-11", asOf)).toBe("d61_90");
    expect(ageingBucket("2026-07-13", asOf)).toBe("d61_90");
    expect(ageingBucket("2026-07-12", asOf)).toBe("d90_plus");
  });
  it("accumulates totals and overdue", () => {
    const t = emptyAgeing();
    addToAgeing(t, "2026-10-20", "2026-10-11", 100n);
    addToAgeing(t, "2026-10-11", "2026-10-11", 50n);
    addToAgeing(t, "2026-09-01", "2026-10-11", 25n);
    addToAgeing(t, "2026-09-01", "2026-10-11", 0n);
    expect(t.total).toBe(175n);
    expect(t.overdue).toBe(25n);
    expect(t.d31_60).toBe(25n);
  });
});

describe("allocation", () => {
  const targets = new Map([
    ["a", { invoiceId: "a", outstanding: 1000n, dueDate: "2026-09-01" }],
    ["b", { invoiceId: "b", outstanding: 500n, dueDate: "2026-08-01" }],
  ]);
  it("returns the unallocated remainder", () => {
    expect(validateAllocations(2000n, [{ invoiceId: "a", amount: 1000n }, { invoiceId: "b", amount: 400n }], targets)).toBe(600n);
  });
  it("rejects over-allocation, duplicates, zero amounts and foreign invoices", () => {
    expect(() => validateAllocations(2000n, [{ invoiceId: "a", amount: 1001n }], targets)).toThrow(AllocationError);
    expect(() => validateAllocations(900n, [{ invoiceId: "a", amount: 500n }, { invoiceId: "b", amount: 500n }], targets)).toThrow(/exceed/);
    expect(() => validateAllocations(2000n, [{ invoiceId: "a", amount: 1n }, { invoiceId: "a", amount: 1n }], targets)).toThrow(/more than once/);
    expect(() => validateAllocations(2000n, [{ invoiceId: "a", amount: 0n }], targets)).toThrow(/greater than zero/);
    expect(() => validateAllocations(2000n, [{ invoiceId: "zzz", amount: 1n }], targets)).toThrow(/not open/);
  });
  it("suggests oldest-due-first allocation", () => {
    expect(suggestAllocations(800n, [...targets.values()])).toEqual([{ invoiceId: "b", amount: 500n }, { invoiceId: "a", amount: 300n }]);
  });
});

describe("promise evaluation", () => {
  const ev = (o: Partial<Parameters<typeof evaluatePromise>[0]>) =>
    evaluatePromise({ promisedDate: "2026-10-10", amount: 1_500_000n, receivedByPromisedDate: 0n, receivedAfter: 0n, today: "2026-10-11", ...o }, addDays);
  it("is kept only when payments cover the amount", () => {
    expect(ev({ receivedByPromisedDate: 1_500_000n }).outcome).toBe("kept");
    expect(ev({ receivedByPromisedDate: 1_500_000n, today: "2026-10-01" }).outcome).toBe("kept");
  });
  it("is not judged before the date passes", () => {
    expect(ev({ today: "2026-10-05" }).outcome).toBe("upcoming");
    expect(ev({ today: "2026-10-10" }).outcome).toBe("due_today");
  });
  it("is broken when nothing was paid by the date — never fabricating a payment", () => {
    const r = ev({});
    expect(r.outcome).toBe("broken");
    expect(r.received).toBe(0n);
    expect(r.shortfall).toBe(1_500_000n);
  });
  it("partial payment preserves the remainder and asks for review", () => {
    const r = ev({ receivedByPromisedDate: 500_000n });
    expect(r.outcome).toBe("partially_kept");
    expect(r.shortfall).toBe(1_000_000n);
    expect(r.needsReview).toBe(true);
  });
  it("a late payment flags review on a broken promise", () => {
    expect(ev({ receivedAfter: 1_500_000n }).needsReview).toBe(true);
  });
  it("escalates at the threshold", () => {
    expect(shouldEscalate(["2026-09-01"], 2)).toBe(false);
    expect(shouldEscalate(["2026-09-01", "2026-10-01"], 2)).toBe(true);
  });
});

describe("collections priority", () => {
  const s = (o: Partial<AccountSignals>): AccountSignals => ({
    today: "2026-10-11", maxDaysOverdue: null, overdueAmount: 0n, outstanding: 0n, hasDueToday: false, promiseDueToday: false,
    unresolvedBrokenPromise: false, brokenPromisesInWindow: 0, lastContactDate: null, overdueSince: null, openDispute: false, disputeHold: false, nextFollowUpDate: null, ...o,
  });
  it("explains every point it adds", () => {
    const r = scoreAccount(s({ maxDaysOverdue: 40, overdueAmount: 20_000_000n, outstanding: 20_000_000n, overdueSince: "2026-09-01" }));
    expect(r.reasons.map((x) => x.text).join("|")).toMatch(/31–60.*|Overdue balance ≥ ₹1 lakh|Never contacted/);
    expect(r.score).toBe(r.reasons.reduce((a, x) => a + x.points, 0));
  });
  it("ranks a small broken-promise account above a large one with a scheduled resolution", () => {
    const small = scoreAccount(s({ maxDaysOverdue: 10, overdueAmount: 1_500_000n, outstanding: 1_500_000n, unresolvedBrokenPromise: true, brokenPromisesInWindow: 1, overdueSince: "2026-10-01" }));
    const large = scoreAccount(s({ maxDaysOverdue: 10, overdueAmount: 90_000_000n, outstanding: 90_000_000n, overdueSince: "2026-10-01", lastContactDate: "2026-10-09", nextFollowUpDate: "2026-10-14" }));
    expect(small.score).toBeGreaterThan(large.score);
    expect(small.recommendedAction).toMatch(/broken promise/);
  });
  it("documented dispute holds lower priority but stay visible", () => {
    const r = scoreAccount(s({ maxDaysOverdue: 20, overdueAmount: 100n, overdueSince: "2026-09-21", openDispute: true, disputeHold: true }));
    expect(r.reasons.some((x) => x.points < 0)).toBe(true);
    expect(r.recommendedAction).toMatch(/dispute/);
  });
  it("accepts configurable weights and ignores junk", () => {
    const w = mergeWeights({ brokenPromise: 99, nonsense: 5, neverContacted: "x" });
    expect(w.brokenPromise).toBe(99);
    expect(w.neverContacted).toBe(DEFAULT_PRIORITY_WEIGHTS.neverContacted);
  });
});

describe("reminder scheduling", () => {
  it("builds one keyed reminder per offset and drops stale ones", () => {
    const s = buildInvoiceSchedule("receivable", "inv1", "2026-10-20", [-3, -1, 0, 1, 3, 7, -3], "2026-10-11");
    expect(s.map((x) => x.offset)).toEqual([-3, -1, 0, 1, 3, 7]);
    expect(new Set(s.map((x) => x.dedupeKey)).size).toBe(s.length);
    expect(s[0].type).toBe("receivable_upcoming");
    expect(s.find((x) => x.offset === 0)!.type).toBe("receivable_due_today");
    expect(s.find((x) => x.offset === 7)!.type).toBe("receivable_overdue");
    const old = buildInvoiceSchedule("receivable", "inv1", "2026-09-01", [1, 3, 7, 30, 45], "2026-10-11");
    expect(old.map((x) => x.offset)).toEqual([45]); // 2026-10-16
  });
  it("keys reminders to the due date so a change creates a new schedule", () => {
    const a = buildInvoiceSchedule("payable", "b1", "2026-10-20", [0], "2026-10-11")[0];
    const b = buildInvoiceSchedule("payable", "b1", "2026-10-25", [0], "2026-10-11")[0];
    expect(a.dedupeKey).not.toBe(b.dedupeKey);
    expect(reminderTypeFor("payable", 2)).toBe("payable_overdue");
  });
  it("treats reminders more than 2 days late as stale", () => {
    expect(isStale("2026-10-09", "2026-10-11")).toBe(false);
    expect(isStale("2026-10-08", "2026-10-11")).toBe(true);
  });
  it("retries with bounded backoff", () => {
    const now = new Date("2026-10-11T05:00:00Z");
    expect(nextRetryAt(1, now)!.getTime() - now.getTime()).toBe(5 * 60_000);
    expect(nextRetryAt(2, now)!.getTime() - now.getTime()).toBe(10 * 60_000);
    expect(nextRetryAt(MAX_DELIVERY_ATTEMPTS, now)).toBeNull();
  });
  it("respects working days and quiet hours", () => {
    const set = { workingDays: [1, 2, 3, 4, 5, 6], reminderStartHour: 9, reminderEndHour: 19 };
    expect(withinWorkingHours({ hour: 10, weekday: 1 }, set)).toBe(true);
    expect(withinWorkingHours({ hour: 19, weekday: 1 }, set)).toBe(false);
    expect(withinWorkingHours({ hour: 10, weekday: 7 }, set)).toBe(false);
  });
});

describe("permissions", () => {
  it("owners get everything, finance managers all but admin, staff only grants", () => {
    expect(effectivePermissions("owner", []).has("members.manage")).toBe(true);
    const fm = effectivePermissions("finance_manager", []);
    expect(fm.has("payments.reverse")).toBe(true);
    expect(fm.has("settings.manage")).toBe(false);
    const staff = effectivePermissions("staff", ["receivables.view", "settings.manage", "bogus"]);
    expect([...staff]).toEqual(["receivables.view"]);
  });
});

describe("CSV export safety", () => {
  it("escapes quotes/commas and neutralises spreadsheet formulas", () => {
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("-12.50")).toBe("-12.50");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(toCsv(["x"], [[1n]])).toContain("\r\n1\r\n");
  });
});
