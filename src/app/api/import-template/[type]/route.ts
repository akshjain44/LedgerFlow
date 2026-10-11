import { getTenantContext } from "@/server/context";
import { templateCsv, IMPORT_TYPES } from "@/server/services/imports";
import { csvResponse } from "@/server/csv";

export async function GET(_req: Request, { params }: { params: Promise<{ type: string }> }) {
  const ctx = await getTenantContext();
  if (!ctx || !ctx.permissions.has("imports.run")) return new Response("Forbidden", { status: 403 });
  const { type } = await params;
  const def = IMPORT_TYPES.find((t) => t.type === type);
  if (!def) return new Response("Not found", { status: 404 });
  return csvResponse(`ledgerflow-${type}-template.csv`, "﻿" + templateCsv(def.type));
}
