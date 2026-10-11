"use server";

import {
  logCommunication, createFollowUp, completeFollowUp, cancelFollowUp, rescheduleFollowUp,
  createPromise, cancelPromise, reviewPromise, createDispute, updateDispute,
  schedulePlannedPayment, reschedulePlannedPayment, cancelPlannedPayment,
} from "@/server/services/collections";
import { fields, list, run, str } from "./_run";

export async function logCallAction(fd: FormData) {
  return run((ctx) => logCommunication(ctx, ({ ...fields(fd), invoiceIds: list(fd, "invoiceIds") } as never)), { message: "Contact recorded" });
}

export async function createFollowUpAction(fd: FormData) {
  return run((ctx) => createFollowUp(ctx, fields(fd) as never), { message: "Follow-up scheduled" });
}

export async function completeFollowUpAction(fd: FormData) {
  return run((ctx) => completeFollowUp(ctx, str(fd, "id"), str(fd, "note") || null), { message: "Follow-up completed" });
}

export async function cancelFollowUpAction(fd: FormData) {
  return run((ctx) => cancelFollowUp(ctx, str(fd, "id"), str(fd, "reason")), { message: "Follow-up cancelled" });
}

export async function rescheduleFollowUpAction(fd: FormData) {
  return run((ctx) => rescheduleFollowUp(ctx, str(fd, "id"), str(fd, "dueDate"), str(fd, "reason") || null), { message: "Follow-up rescheduled" });
}

export async function createPromiseAction(fd: FormData) {
  return run((ctx) => createPromise(ctx, ({ ...fields(fd), invoiceIds: list(fd, "invoiceIds") } as never)), { message: "Promise recorded — it counts only when payment is received" });
}

export async function cancelPromiseAction(fd: FormData) {
  return run((ctx) => cancelPromise(ctx, str(fd, "id"), str(fd, "reason")), { message: "Promise cancelled" });
}

export async function reviewPromiseAction(fd: FormData) {
  const date = str(fd, "carryDate");
  return run((ctx) => reviewPromise(ctx, str(fd, "id"), str(fd, "note"), date ? { date } : null), { message: "Review recorded" });
}

export async function createDisputeAction(fd: FormData) {
  return run((ctx) => createDispute(ctx, fields(fd) as never), { message: "Dispute recorded" });
}

export async function updateDisputeAction(fd: FormData) {
  return run((ctx) => updateDispute(ctx, str(fd, "id"), fields(fd) as never), { message: "Dispute updated" });
}

export async function schedulePaymentAction(fd: FormData) {
  return run((ctx) => schedulePlannedPayment(ctx, fields(fd) as never), { message: "Payment planned (not yet paid)" });
}

export async function reschedulePaymentAction(fd: FormData) {
  return run((ctx) => reschedulePlannedPayment(ctx, str(fd, "id"), str(fd, "plannedDate"), str(fd, "reason")), { message: "Planned payment rescheduled" });
}

export async function cancelPlannedPaymentAction(fd: FormData) {
  return run((ctx) => cancelPlannedPayment(ctx, str(fd, "id"), str(fd, "reason")), { message: "Planned payment cancelled" });
}
