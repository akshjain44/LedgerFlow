"use server";

import { tenantOrThrow } from "@/server/context";
import { openInvoicesFor } from "@/server/queries/invoices";
import { formatINR } from "@/domain/money";
import { formatDate } from "@/domain/dates";

/** Open invoices for the payment allocation form. Amounts are returned as display strings. */
export async function loadOpenInvoicesAction(counterpartyId: string, direction: "receivable" | "payable") {
  const ctx = await tenantOrThrow(direction === "receivable" ? "receivables.view" : "payables.view");
  if (!/^[0-9a-f-]{36}$/i.test(counterpartyId)) return [];
  const rows = await openInvoicesFor(ctx, counterpartyId, direction);
  return rows.map((r) => ({ id: r.id, invoiceNumber: r.invoiceNumber, dueDate: r.dueDate, dueLabel: formatDate(r.dueDate), outstanding: formatINR(r.outstanding, { symbol: false }) }));
}
