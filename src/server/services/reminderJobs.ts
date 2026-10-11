import "server-only";
import type { BusinessSettings } from "@prisma/client";
import type { Tx } from "../db";
import { buildInvoiceSchedule } from "@/domain/reminderSchedule";
import { fromDbDate, toDbDate } from "@/domain/dates";
import { paise } from "./common";

const SETTLED = "Invoice settled";
const DISABLED = "Reminders disabled";
const NOT_OPEN = "Invoice not open";

/**
 * Brings an invoice's stored reminder schedule in line with its current
 * state. Idempotent: safe to call after any change and from the processor.
 * - settled / void / draft / reminders off → pending jobs cancelled
 * - due date changed → jobs for the old due date cancelled, new ones created
 * - re-opened (e.g. a payment was reversed) → jobs cancelled for settlement come back
 */
export async function syncInvoiceReminders(tx: Tx, businessId: string, invoiceId: string, today: string, settings: BusinessSettings) {
  const inv = await tx.invoice.findUnique({ where: { id: invoiceId } });
  if (!inv) return;
  const dueDate = fromDbDate(inv.dueDate);
  const outstanding = paise(inv.outstandingAmount);

  let cancelReason: string | null = null;
  if (inv.lifecycle !== "open") cancelReason = NOT_OPEN;
  else if (outstanding <= 0n) cancelReason = SETTLED;
  else if (!inv.remindersEnabled || !settings.remindersEnabled) cancelReason = DISABLED;

  if (cancelReason) {
    await tx.reminderJob.updateMany({
      where: { invoiceId, status: "pending" },
      data: { status: "cancelled", statusReason: cancelReason, processedAt: new Date() },
    });
    return;
  }

  // Obsolete: scheduled against a different due date.
  await tx.reminderJob.updateMany({
    where: { invoiceId, status: "pending", NOT: { dueDateSnapshot: inv.dueDate } },
    data: { status: "cancelled", statusReason: "Due date changed", processedAt: new Date() },
  });

  const offsets = inv.direction === "receivable" ? settings.receivableReminderOffsets : settings.payableReminderOffsets;
  const schedule = buildInvoiceSchedule(inv.direction, inv.id, dueDate, offsets, today);
  if (schedule.length === 0) return;

  await tx.reminderJob.createMany({
    data: schedule.map((s) => ({
      businessId,
      type: s.type,
      dedupeKey: s.dedupeKey,
      scheduledFor: toDbDate(s.scheduledFor),
      invoiceId: inv.id,
      counterpartyId: inv.counterpartyId,
      dueDateSnapshot: inv.dueDate,
    })),
    skipDuplicates: true,
  });

  // Re-open jobs that were only cancelled because the invoice was settled or
  // reminders were off, now that it has a balance again.
  await tx.reminderJob.updateMany({
    where: {
      invoiceId,
      status: "cancelled",
      statusReason: { in: [SETTLED, DISABLED, NOT_OPEN] },
      dedupeKey: { in: schedule.map((s) => s.dedupeKey) },
    },
    data: { status: "pending", statusReason: null, processedAt: null },
  });
}
