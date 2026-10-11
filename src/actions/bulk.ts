"use server";

import { bulkAssign } from "@/server/services/invoices";
import { createFollowUp } from "@/server/services/collections";
import { withTenant } from "@/server/db";
import { list, run, str } from "./_run";

export async function bulkAssignAction(fd: FormData) {
  const direction = str(fd, "direction") === "payable" ? "payable" : "receivable";
  const user = str(fd, "assignTo");
  return run((ctx) => bulkAssign(ctx, direction, list(fd, "ids"), user === "unassigned" ? null : user), { message: (n) => `${n} reassigned` });
}

export async function bulkFollowUpAction(fd: FormData) {
  const ids = list(fd, "ids");
  const date = str(fd, "dueDate");
  return run(
    async (ctx) => {
      const invoices = await withTenant(ctx.businessId, (tx) => tx.invoice.findMany({ where: { id: { in: ids } }, include: { counterparty: { select: { name: true } } } }));
      for (const i of invoices) {
        await createFollowUp(ctx, { counterpartyId: i.counterpartyId, invoiceId: i.id, type: "call", title: `Call ${i.counterparty.name} about ${i.invoiceNumber}`, dueDate: date, assignedUserId: i.assignedUserId ?? undefined });
      }
      return invoices.length;
    },
    { message: (n) => `${n} follow-ups scheduled` },
  );
}
