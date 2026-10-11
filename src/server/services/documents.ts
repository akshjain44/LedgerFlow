import "server-only";
import { createHash } from "node:crypto";
import type { DocumentKind } from "@prisma/client";
import { withTenant } from "../db";
import { assertCan, type TenantContext } from "../context";
import { AppError, NotFoundError } from "../errors";
import { audit } from "../audit";
import { MAX_UPLOAD_BYTES, newStorageKey, sniffType, storage } from "../storage";

export const DOCUMENT_KINDS: { value: DocumentKind; label: string }[] = [
  { value: "invoice", label: "Customer invoice" },
  { value: "supplier_bill", label: "Supplier bill" },
  { value: "purchase_order", label: "Purchase order" },
  { value: "delivery_challan", label: "Delivery challan / proof of delivery" },
  { value: "payment_confirmation", label: "Payment confirmation" },
  { value: "dispute_evidence", label: "Dispute evidence" },
  { value: "other", label: "Other" },
];

export async function uploadDocument(
  ctx: TenantContext,
  file: File,
  link: { kind: string; invoiceId?: string | null; counterpartyId?: string | null; paymentId?: string | null; disputeId?: string | null },
) {
  assertCan(ctx, "documents.manage");
  if (!(file instanceof File) || file.size === 0) throw new AppError("Choose a file to upload", { file: "Required" });
  if (file.size > MAX_UPLOAD_BYTES) throw new AppError("Files must be 10 MB or smaller", { file: "Too large" });
  const kind = DOCUMENT_KINDS.find((k) => k.value === link.kind)?.value;
  if (!kind) throw new AppError("Choose a document type", { kind: "Required" });
  const buf = Buffer.from(await file.arrayBuffer());
  const type = sniffType(buf);
  if (!type) throw new AppError("Only PDF, PNG, JPEG or WebP files are accepted", { file: "Unsupported type" });
  const originalName = file.name.replace(/[^\w.\- ()]/g, "_").slice(0, 150) || `document.${type.ext}`;

  return withTenant(ctx.businessId, async (tx) => {
    // Every referenced record is looked up inside the tenant scope (RLS) before linking.
    let counterpartyId = link.counterpartyId || null;
    if (link.invoiceId) {
      const inv = await tx.invoice.findUnique({ where: { id: link.invoiceId } });
      if (!inv) throw new NotFoundError("Invoice");
      assertCan(ctx, inv.direction === "receivable" ? "receivables.view" : "payables.view");
      counterpartyId = inv.counterpartyId;
    }
    if (link.paymentId && !(await tx.payment.findUnique({ where: { id: link.paymentId } }))) throw new NotFoundError("Payment");
    if (link.disputeId && !(await tx.dispute.findUnique({ where: { id: link.disputeId } }))) throw new NotFoundError("Dispute");
    if (counterpartyId && !(await tx.counterparty.findUnique({ where: { id: counterpartyId } }))) throw new NotFoundError("Account");

    const key = newStorageKey(ctx.businessId, type.ext);
    await storage().put(key, buf);
    try {
      const doc = await tx.document.create({
        data: {
          businessId: ctx.businessId,
          kind,
          originalName,
          storageKey: key,
          mimeType: type.mime,
          sizeBytes: buf.length,
          sha256: createHash("sha256").update(buf).digest("hex"),
          counterpartyId,
          invoiceId: link.invoiceId || null,
          paymentId: link.paymentId || null,
          disputeId: link.disputeId || null,
          uploadedById: ctx.userId,
        },
      });
      await audit(tx, {
        businessId: ctx.businessId,
        actorUserId: ctx.userId,
        action: "document.uploaded",
        entityType: link.invoiceId ? "invoice" : link.paymentId ? "payment" : "counterparty",
        entityId: link.invoiceId || link.paymentId || counterpartyId,
        summary: `${DOCUMENT_KINDS.find((k) => k.value === kind)?.label} uploaded: ${originalName} (contents not verified)`,
      });
      return doc;
    } catch (e) {
      await storage().remove(key);
      throw e;
    }
  });
}

/** Soft delete: metadata and the audit trail remain; the file is retained for the audit period. */
export async function deleteDocument(ctx: TenantContext, id: string, reason: string) {
  assertCan(ctx, "documents.manage");
  if (!reason || reason.trim().length < 3) throw new AppError("Give a reason", { reason: "Required" });
  return withTenant(ctx.businessId, async (tx) => {
    const doc = await tx.document.findUnique({ where: { id } });
    if (!doc || doc.deletedAt) throw new NotFoundError("Document");
    await tx.document.update({ where: { id }, data: { deletedAt: new Date(), deletedById: ctx.userId } });
    await audit(tx, { businessId: ctx.businessId, actorUserId: ctx.userId, action: "document.deleted", entityType: doc.invoiceId ? "invoice" : "counterparty", entityId: doc.invoiceId ?? doc.counterpartyId, summary: `Document removed: ${doc.originalName} — ${reason.trim()}` });
  });
}
