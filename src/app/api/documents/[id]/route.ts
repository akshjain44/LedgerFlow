import { getTenantContext } from "@/server/context";
import { prisma, withTenant } from "@/server/db";
import { storage, verifyDocumentSignature } from "@/server/storage";

export const dynamic = "force-dynamic";

/**
 * Serves a private document. Requires (1) a valid, unexpired signature bound
 * to this document and user, and (2) a signed-in user who is an active member
 * of the document's business — the lookup runs under that business's RLS.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const ctx = await getTenantContext();
  if (!ctx) return new Response("Sign in required", { status: 401 });
  const url = new URL(req.url);
  if (!verifyDocumentSignature(id, ctx.userId, url.searchParams.get("exp"), url.searchParams.get("sig"))) {
    return new Response("Link expired or invalid. Reopen the document from the app.", { status: 403 });
  }
  // Only memberships of this user are considered; the document must belong to one of them.
  const memberships = await prisma.membership.findMany({ where: { userId: ctx.userId, status: "active" }, select: { businessId: true } });
  for (const m of memberships) {
    const doc = await withTenant(m.businessId, (tx) => tx.document.findFirst({ where: { id, deletedAt: null } }));
    if (!doc) continue;
    const needs = doc.invoiceId
      ? await withTenant(m.businessId, (tx) => tx.invoice.findUnique({ where: { id: doc.invoiceId! }, select: { direction: true } }))
      : null;
    if (m.businessId !== ctx.businessId) return new Response("Switch to the document's business to open it.", { status: 403 });
    if (needs && !ctx.permissions.has(needs.direction === "receivable" ? "receivables.view" : "payables.view")) return new Response("Forbidden", { status: 403 });
    const data = await storage().get(doc.storageKey);
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": doc.mimeType,
        "Content-Disposition": `inline; filename="${doc.originalName.replace(/"/g, "")}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      },
    });
  }
  return new Response("Not found", { status: 404 });
}
