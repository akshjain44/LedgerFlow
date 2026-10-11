"use server";

import { markAllRead, markRead } from "@/server/services/notifications";
import { uploadDocument, deleteDocument } from "@/server/services/documents";
import { renderTemplate, sendOrRecordMessage } from "@/server/services/messages";
import { previewImport, commitImport } from "@/server/services/imports";
import { tenantOrThrow } from "@/server/context";
import { toActionError, type ActionResult } from "@/server/errors";
import { run, str } from "./_run";
import type { ImportType } from "@prisma/client";

export async function markReadAction(fd: FormData) {
  return run((ctx) => markRead(ctx, str(fd, "id")), { message: "Marked as read" });
}

export async function markAllReadAction() {
  return run((ctx) => markAllRead(ctx), { message: "All notifications marked as read" });
}

export async function uploadDocumentAction(fd: FormData) {
  const file = fd.get("file");
  return run(
    (ctx) => uploadDocument(ctx, file as File, { kind: str(fd, "kind"), invoiceId: str(fd, "invoiceId") || null, counterpartyId: str(fd, "counterpartyId") || null, paymentId: str(fd, "paymentId") || null, disputeId: str(fd, "disputeId") || null }),
    { message: "Document uploaded" },
  );
}

export async function deleteDocumentAction(fd: FormData) {
  return run((ctx) => deleteDocument(ctx, str(fd, "id"), str(fd, "reason")), { message: "Document removed" });
}

export async function renderTemplateAction(key: string, counterpartyId: string, invoiceId: string | null) {
  try {
    const ctx = await tenantOrThrow("collections.work");
    return { ok: true as const, data: await renderTemplate(ctx, key, counterpartyId, invoiceId) };
  } catch (e) {
    return toActionError(e);
  }
}

export async function sendMessageAction(fd: FormData) {
  return run(
    (ctx) =>
      sendOrRecordMessage(ctx, {
        counterpartyId: str(fd, "counterpartyId"),
        invoiceId: str(fd, "invoiceId") || null,
        templateKey: str(fd, "templateKey"),
        channel: str(fd, "channel") === "email" ? "email" : "copy",
        recipient: str(fd, "recipient"),
        subject: str(fd, "subject"),
        body: str(fd, "body"),
      }),
    { message: (s) => (s === "sent" ? "Email sent and logged" : "Message recorded as prepared") },
  );
}

export async function previewImportAction(type: ImportType, csv: string, mapping: Record<string, string> | null): Promise<ActionResult<Awaited<ReturnType<typeof previewImport>>>> {
  try {
    const ctx = await tenantOrThrow("imports.run");
    return { ok: true, data: await previewImport(ctx, type, csv, mapping) };
  } catch (e) {
    return toActionError(e);
  }
}

export async function commitImportAction(type: ImportType, csv: string, fileName: string, mapping: Record<string, string>, skip: number[]): Promise<ActionResult<Awaited<ReturnType<typeof commitImport>>>> {
  try {
    const ctx = await tenantOrThrow("imports.run");
    return { ok: true, data: await commitImport(ctx, type, csv, fileName, mapping, skip) };
  } catch (e) {
    return toActionError(e);
  }
}
