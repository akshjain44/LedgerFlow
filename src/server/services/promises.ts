import "server-only";
import type { PaymentPromise, PromiseStatus } from "@prisma/client";
import type { Tx } from "../db";
import { addDays, fromDbDate, todayIn } from "@/domain/dates";
import { evaluatePromise } from "@/domain/promises";
import { dec, paise } from "./common";
import { audit } from "../audit";

export interface PromiseTransition {
  promise: PaymentPromise;
  from: PromiseStatus;
  to: PromiseStatus;
}

/**
 * Re-evaluates promises against payments actually allocated to the promised
 * invoices. Never marks a promise kept because time passed, and never
 * invents a payment. Returns transitions so callers can raise reminders.
 */
export async function evaluatePromises(
  tx: Tx,
  opts: { businessId: string; timezone: string; today: string; counterpartyId?: string; actorUserId?: string | null },
): Promise<PromiseTransition[]> {
  const promises = await tx.paymentPromise.findMany({
    where: {
      businessId: opts.businessId,
      status: { in: ["upcoming", "kept", "partially_kept", "broken"] },
      ...(opts.counterpartyId ? { counterpartyId: opts.counterpartyId } : {}),
      // Old settled outcomes are final for practical purposes.
      promisedDate: { gte: new Date(Date.parse(opts.today + "T00:00:00Z") - 400 * 86_400_000) },
    },
    include: { invoices: { select: { invoiceId: true } } },
  });

  const transitions: PromiseTransition[] = [];
  for (const p of promises) {
    const promisedDate = fromDbDate(p.promisedDate);
    const recordedDate = todayIn(opts.timezone, p.recordedAt);
    const invoiceIds = p.invoices.map((i) => i.invoiceId);
    const allocations = await tx.paymentAllocation.findMany({
      where: {
        status: "active",
        payment: { status: "active", direction: "received", counterpartyId: p.counterpartyId, paymentDate: { gte: new Date(recordedDate + "T00:00:00Z") } },
        ...(invoiceIds.length > 0 ? { invoiceId: { in: invoiceIds } } : { invoice: { direction: "receivable" } }),
      },
      include: { payment: { select: { paymentDate: true } } },
    });
    let byDate = 0n;
    let after = 0n;
    for (const a of allocations) {
      if (fromDbDate(a.payment.paymentDate) <= promisedDate) byDate += paise(a.amount);
      else after += paise(a.amount);
    }
    const result = evaluatePromise(
      { promisedDate, amount: paise(p.amount), receivedByPromisedDate: byDate, receivedAfter: after, today: opts.today },
      addDays,
    );
    const next: PromiseStatus = result.outcome === "due_today" ? "upcoming" : result.outcome;
    const receivedChanged = paise(p.amountReceived) !== byDate;
    if (next !== p.status || receivedChanged || p.needsReview !== result.needsReview) {
      const updated = await tx.paymentPromise.update({
        where: { id: p.id },
        data: { status: next, amountReceived: dec(byDate), evaluatedAt: new Date(), needsReview: result.needsReview },
      });
      if (next !== p.status) {
        transitions.push({ promise: updated, from: p.status, to: next });
        await audit(tx, {
          businessId: opts.businessId,
          actorUserId: opts.actorUserId ?? null,
          action: "promise.evaluated",
          entityType: "promise",
          entityId: p.id,
          summary: `Promise ${p.status} → ${next}: ${result.explanation}`,
          before: { status: p.status },
          after: { status: next, received: byDate, shortfall: result.shortfall },
        });
      }
    }
  }
  return transitions;
}
