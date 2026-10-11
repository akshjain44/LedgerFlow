import type { Paise } from "@/domain/money";

/** Paise → rupees as a JS number, for chart rendering only (never for calculations). */
export const chartRupees = (p: Paise) => Number(p / 100n);

export function pct(n: number | null, digits = 0) {
  return n === null ? "—" : `${(n * 100).toFixed(digits)}%`;
}

export const OUTCOME_LABELS: Record<string, string> = {
  no_answer: "No answer",
  unavailable: "Unavailable",
  payment_promised: "Payment promised",
  part_payment_received: "Part payment received",
  payment_completed: "Payment completed",
  invoice_dispute: "Invoice dispute",
  delivery_dispute: "Delivery/quantity dispute",
  rate_discrepancy: "Rate discrepancy",
  cash_flow_difficulty: "Cash-flow difficulty",
  extension_requested: "Extension requested",
  refused: "Refused to pay",
  wrong_contact: "Wrong contact details",
  escalated: "Escalated",
  other: "Other",
};
