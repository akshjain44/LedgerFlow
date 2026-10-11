"use server";

import { recordPayment, allocatePayment, reverseAllocation, reversePayment, reallocate } from "@/server/services/payments";
import { fields, run, str } from "./_run";

function allocationsFrom(fd: FormData) {
  const out: { invoiceId: string; amount: string }[] = [];
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("alloc_") && typeof v === "string" && v.trim() !== "") out.push({ invoiceId: k.slice(6), amount: v });
  }
  return out;
}

export async function recordPaymentAction(fd: FormData) {
  const f = fields(fd);
  return run((ctx) => recordPayment(ctx, ({ ...f, allocations: allocationsFrom(fd) } as never)), {
    message: "Payment recorded",
    redirect: (p) => (str(fd, "returnTo").startsWith("/") ? str(fd, "returnTo") : `/payments/${p.id}`),
  });
}

export async function allocatePaymentAction(fd: FormData) {
  return run((ctx) => allocatePayment(ctx, str(fd, "paymentId"), allocationsFrom(fd)), { message: "Allocation saved" });
}

export async function reverseAllocationAction(fd: FormData) {
  return run((ctx) => reverseAllocation(ctx, str(fd, "id"), str(fd, "reason")), { message: "Allocation reversed" });
}

export async function reallocateAction(fd: FormData) {
  return run((ctx) => reallocate(ctx, str(fd, "id"), str(fd, "toInvoiceId"), str(fd, "reason")), { message: "Allocation moved" });
}

export async function reversePaymentAction(fd: FormData) {
  return run((ctx) => reversePayment(ctx, str(fd, "id"), str(fd, "reason")), { message: "Payment reversed" });
}
