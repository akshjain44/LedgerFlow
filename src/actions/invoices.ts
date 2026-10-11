"use server";

import { createInvoice, updateInvoice, voidInvoice, issueDraft } from "@/server/services/invoices";
import { addAdjustment, reverseAdjustment } from "@/server/services/payments";
import { fields, run, str } from "./_run";

const base = (d: string) => (d === "payable" ? "/payables" : "/receivables");

export async function createInvoiceAction(fd: FormData) {
  const direction = str(fd, "direction") === "payable" ? "payable" : "receivable";
  return run((ctx) => createInvoice(ctx, direction, fields(fd) as never), {
    message: (i) => `${direction === "payable" ? "Bill" : "Invoice"} ${i.invoiceNumber} saved`,
    redirect: (i) => `${base(direction)}/${i.id}`,
  });
}

export async function updateInvoiceAction(fd: FormData) {
  const id = str(fd, "id");
  return run((ctx) => updateInvoice(ctx, id, fields(fd) as never), { message: "Changes saved", redirect: (i) => `${base(i.direction)}/${id}` });
}

export async function voidInvoiceAction(fd: FormData) {
  return run((ctx) => voidInvoice(ctx, str(fd, "id"), str(fd, "reason")), { message: "Invoice voided" });
}

export async function issueDraftAction(fd: FormData) {
  return run((ctx) => issueDraft(ctx, str(fd, "id")), { message: "Invoice issued" });
}

export async function addAdjustmentAction(fd: FormData) {
  return run((ctx) => addAdjustment(ctx, str(fd, "invoiceId"), fields(fd) as never), { message: "Adjustment recorded" });
}

export async function reverseAdjustmentAction(fd: FormData) {
  return run((ctx) => reverseAdjustment(ctx, str(fd, "id"), str(fd, "reason")), { message: "Adjustment reversed" });
}
