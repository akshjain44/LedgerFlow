import "server-only";
import { createHash } from "node:crypto";
import Papa from "papaparse";
import type { ImportType } from "@prisma/client";
import { withTenant, type Tx } from "../db";
import { assertCan, type TenantContext } from "../authz";
import { AppError } from "../errors";
import { audit } from "../audit";
import { parseFlexibleDate } from "@/domain/dates";
import { parseAmount, toDecimalString, formatINR } from "@/domain/money";
import { createCounterpartyTx } from "./counterparties";
import { createInvoiceTx } from "./invoices";
import { recordPaymentTx } from "./payments";
import { loadSettings, paise } from "./common";

export interface FieldDef {
  key: string;
  label: string;
  required: boolean;
  aliases: string[];
  hint?: string;
}

const CP_FIELDS: FieldDef[] = [
  { key: "name", label: "Business name", required: true, aliases: ["name", "business name", "party", "party name", "customer", "supplier", "company"] },
  { key: "contact_person", label: "Contact person", required: false, aliases: ["contact", "contact person", "contact name"] },
  { key: "phone", label: "Phone", required: false, aliases: ["phone", "mobile", "phone number", "contact number"] },
  { key: "email", label: "Email", required: false, aliases: ["email", "email address", "e-mail"] },
  { key: "gstin", label: "GSTIN", required: false, aliases: ["gstin", "gst", "gst number", "gst no"] },
  { key: "account_code", label: "Account code", required: false, aliases: ["account code", "code", "ledger code", "party code"] },
  { key: "credit_days", label: "Credit period (days)", required: false, aliases: ["credit days", "credit period", "terms days"] },
  { key: "payment_terms", label: "Payment terms", required: false, aliases: ["payment terms", "terms"] },
  { key: "credit_limit", label: "Credit limit", required: false, aliases: ["credit limit", "limit"] },
  { key: "billing_address", label: "Billing address", required: false, aliases: ["address", "billing address"] },
  { key: "notes", label: "Notes", required: false, aliases: ["notes", "remarks"] },
];

const INVOICE_FIELDS = (party: string): FieldDef[] => [
  { key: "party", label: `${party} (name or account code)`, required: true, aliases: [party.toLowerCase(), "party", "party name", "name", "account code"] },
  { key: "invoice_number", label: party === "Customer" ? "Invoice number" : "Supplier bill number", required: true, aliases: ["invoice number", "invoice no", "invoice", "bill number", "bill no", "number"] },
  { key: "invoice_date", label: "Invoice date", required: true, aliases: ["invoice date", "bill date", "date"], hint: "DD/MM/YYYY or YYYY-MM-DD" },
  { key: "due_date", label: "Due date", required: false, aliases: ["due date", "due"], hint: "Optional; otherwise invoice date + credit days" },
  { key: "credit_days", label: "Credit days", required: false, aliases: ["credit days", "credit period", "terms days"] },
  { key: "total_amount", label: "Total amount", required: true, aliases: ["total", "total amount", "amount", "invoice amount", "bill amount"] },
  { key: "tax_amount", label: "Tax amount", required: false, aliases: ["tax", "tax amount", "gst amount"] },
  { key: "po_reference", label: "PO reference", required: false, aliases: ["po", "po number", "po reference", "purchase order"] },
  { key: "delivery_reference", label: party === "Customer" ? "Delivery challan ref." : "Goods receipt ref.", required: false, aliases: ["challan", "dc", "delivery challan", "grn", "goods receipt", "delivery reference"] },
  { key: "notes", label: "Notes", required: false, aliases: ["notes", "remarks"] },
];

const PAYMENT_FIELDS: FieldDef[] = [
  { key: "direction", label: "Direction (received / made)", required: true, aliases: ["direction", "type"], hint: "received = from customer, made = to supplier" },
  { key: "party", label: "Customer / supplier (name or code)", required: true, aliases: ["party", "customer", "supplier", "name", "account code"] },
  { key: "amount", label: "Amount", required: true, aliases: ["amount", "payment amount"] },
  { key: "payment_date", label: "Payment date", required: true, aliases: ["date", "payment date"] },
  { key: "method", label: "Method", required: true, aliases: ["method", "mode", "payment method"] },
  { key: "reference", label: "Reference / UTR / cheque no.", required: false, aliases: ["reference", "ref", "utr", "cheque no", "transaction id"] },
  { key: "invoice_number", label: "Allocate to invoice number", required: false, aliases: ["invoice number", "invoice", "bill number", "allocate to"], hint: "Leave blank to keep the payment unallocated" },
  { key: "allocated_amount", label: "Allocated amount", required: false, aliases: ["allocated", "allocated amount"], hint: "Defaults to the payment amount when an invoice is given" },
  { key: "notes", label: "Notes", required: false, aliases: ["notes", "remarks"] },
];

export const IMPORT_TYPES: { type: ImportType; label: string; fields: FieldDef[] }[] = [
  { type: "customers", label: "Customers", fields: CP_FIELDS },
  { type: "suppliers", label: "Suppliers", fields: CP_FIELDS },
  { type: "receivables", label: "Receivable invoices", fields: INVOICE_FIELDS("Customer") },
  { type: "payables", label: "Supplier bills", fields: INVOICE_FIELDS("Supplier") },
  { type: "payments", label: "Historical payments", fields: PAYMENT_FIELDS },
];

export function templateCsv(type: ImportType): string {
  const def = IMPORT_TYPES.find((t) => t.type === type)!;
  const header = def.fields.map((f) => f.key).join(",");
  const examples: Record<ImportType, string> = {
    customers: `Example Traders (fictional),Ravi Kumar,+91 90000 00001,accounts@example.com,,CUST-001,30,Net 30,500000,"Plot 1, Example Industrial Area",Generated example row - delete before importing`,
    suppliers: `Example Chemicals (fictional),Anita Rao,+91 90000 00002,ar@example.com,,SUP-001,45,Net 45,,"Unit 2, Example Estate",Generated example row - delete before importing`,
    receivables: `CUST-001,INV-1001,01/09/2026,,30,59000.00,9000.00,PO-55,DC-778,Generated example row - delete before importing`,
    payables: `SUP-001,SB-2201,05/09/2026,20/10/2026,,118000.00,18000.00,PO-12,GRN-91,Generated example row - delete before importing`,
    payments: `received,CUST-001,20000.00,15/09/2026,UPI,UTR123456,INV-1001,20000.00,Generated example row - delete before importing`,
  };
  return `${header}\n${examples[type]}\n`;
}

export function autoMap(type: ImportType, headers: string[]): Record<string, string> {
  const def = IMPORT_TYPES.find((t) => t.type === type)!;
  const norm = (s: string) => s.toLowerCase().replace(/[_\-.]/g, " ").replace(/\s+/g, " ").trim();
  const map: Record<string, string> = {};
  for (const f of def.fields) {
    const hit = headers.find((h) => norm(h) === f.key.replace(/_/g, " ") || f.aliases.includes(norm(h)));
    if (hit) map[f.key] = hit;
  }
  return map;
}

export function parseCsv(text: string) {
  if (text.length > 5 * 1024 * 1024) throw new AppError("CSV files must be under 5 MB");
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), { header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim() });
  if (parsed.errors.length && parsed.data.length === 0) throw new AppError(`Could not read the CSV: ${parsed.errors[0].message}`);
  if (parsed.data.length > 5000) throw new AppError("Import at most 5,000 rows at a time");
  return { headers: (parsed.meta.fields ?? []).filter(Boolean), rows: parsed.data };
}

export interface RowResult {
  rowNumber: number;
  values: Record<string, string>;
  errors: string[];
  duplicate: string | null;
}

async function findParty(tx: Tx, value: string, role: "customer" | "supplier") {
  const v = value.trim();
  return tx.counterparty.findFirst({
    where: {
      ...(role === "customer" ? { isCustomer: true } : { isSupplier: true }),
      OR: [{ accountCode: { equals: v, mode: "insensitive" } }, { name: { equals: v, mode: "insensitive" } }],
    },
  });
}

/** Validates every row without writing anything. Used for the preview and again at commit. */
async function validateRows(tx: Tx, ctx: TenantContext, type: ImportType, rows: Record<string, string>[], mapping: Record<string, string>): Promise<RowResult[]> {
  const def = IMPORT_TYPES.find((t) => t.type === type)!;
  const { settings } = await loadSettings(tx, ctx.businessId);
  const seen = new Map<string, number>();
  const out: RowResult[] = [];
  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const values: Record<string, string> = {};
    for (const f of def.fields) values[f.key] = mapping[f.key] ? (raw[mapping[f.key]] ?? "").trim() : "";
    const errors: string[] = [];
    let duplicate: string | null = null;
    for (const f of def.fields) if (f.required && !values[f.key]) errors.push(`${f.label} is required`);
    const amountOk = (key: string, label: string, required = false) => {
      if (!values[key]) return required ? null : null;
      try {
        const p = parseAmount(values[key]);
        if (p <= 0n) errors.push(`${label} must be greater than zero`);
        return p;
      } catch {
        errors.push(`${label} “${values[key]}” is not a valid amount`);
        return null;
      }
    };
    const dateOk = (key: string, label: string) => {
      if (!values[key]) return null;
      const d = parseFlexibleDate(values[key]);
      if (!d) errors.push(`${label} “${values[key]}” is not a valid date (use DD/MM/YYYY or YYYY-MM-DD)`);
      return d;
    };

    if (type === "customers" || type === "suppliers") {
      if (values.credit_days && !/^\d{1,3}$/.test(values.credit_days)) errors.push("Credit period must be a whole number of days");
      if (values.credit_limit) {
        try {
          parseAmount(values.credit_limit);
        } catch {
          errors.push("Credit limit is not a valid amount");
        }
      }
      if (values.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.email)) errors.push("Email looks invalid");
      const key = (values.account_code || values.name).toLowerCase();
      if (key && seen.has(key)) duplicate = `Same as row ${seen.get(key)} in this file`;
      else if (key) seen.set(key, i + 2);
      if (!duplicate && values.name) {
        const existing = await tx.counterparty.findFirst({
          where: { OR: [{ name: { equals: values.name, mode: "insensitive" } }, ...(values.account_code ? [{ accountCode: { equals: values.account_code, mode: "insensitive" as const } }] : [])] },
        });
        if (existing) {
          const role = type === "customers" ? existing.isCustomer : existing.isSupplier;
          duplicate = role ? `Already exists: ${existing.name}` : null;
          if (!role) values.__existingId = existing.id; // will be marked as the extra role
        }
      }
    } else if (type === "receivables" || type === "payables") {
      const role = type === "receivables" ? "customer" : "supplier";
      const total = amountOk("total_amount", "Total amount", true);
      const tax = amountOk("tax_amount", "Tax amount");
      if (tax !== null && total !== null && tax >= total) errors.push("Tax amount must be less than the total");
      const inv = dateOk("invoice_date", "Invoice date");
      const due = dateOk("due_date", "Due date");
      if (inv && due && due < inv) errors.push("Due date is before the invoice date");
      if (inv && inv > ctx.today) errors.push("Invoice date is in the future");
      if (values.credit_days && !/^\d{1,3}$/.test(values.credit_days)) errors.push("Credit days must be a whole number");
      let partyId: string | null = null;
      if (values.party) {
        const party = await findParty(tx, values.party, role);
        if (!party) errors.push(`${role === "customer" ? "Customer" : "Supplier"} “${values.party}” not found — import or create it first`);
        else partyId = party.id;
      }
      if (values.invoice_number) {
        const k = `${type === "payables" ? partyId : ""}:${values.invoice_number.toLowerCase()}`;
        if (seen.has(k)) duplicate = `Same invoice number as row ${seen.get(k)} in this file`;
        else seen.set(k, i + 2);
        if (!duplicate) {
          const existing = await tx.invoice.findFirst({
            where: { direction: type === "receivables" ? "receivable" : "payable", invoiceNumber: { equals: values.invoice_number, mode: "insensitive" }, ...(type === "payables" && partyId ? { counterpartyId: partyId } : {}) },
          });
          if (existing) duplicate = `Invoice ${existing.invoiceNumber} already exists`;
        }
      }
      if (partyId) values.__partyId = partyId;
    } else if (type === "payments") {
      const dir = values.direction.toLowerCase();
      if (values.direction && !["received", "made"].includes(dir)) errors.push("Direction must be “received” or “made”");
      const amount = amountOk("amount", "Amount", true);
      const date = dateOk("payment_date", "Payment date");
      if (date && date > ctx.today) errors.push("Payment date is in the future");
      if (values.method && !settings.paymentMethods.some((m) => m.toLowerCase() === values.method.toLowerCase())) {
        errors.push(`Method “${values.method}” is not configured (Settings → Financial). Use one of: ${settings.paymentMethods.join(", ")}`);
      } else if (values.method) {
        values.method = settings.paymentMethods.find((m) => m.toLowerCase() === values.method.toLowerCase())!;
      }
      const role = dir === "made" ? "supplier" : "customer";
      const party = values.party ? await findParty(tx, values.party, role) : null;
      if (values.party && !party) errors.push(`${role === "customer" ? "Customer" : "Supplier"} “${values.party}” not found`);
      if (party) values.__partyId = party.id;
      const alloc = values.allocated_amount ? amountOk("allocated_amount", "Allocated amount") : amount;
      if (values.allocated_amount && !values.invoice_number) errors.push("Allocated amount given without an invoice number");
      if (values.invoice_number && party) {
        const inv = await tx.invoice.findFirst({ where: { counterpartyId: party.id, direction: dir === "made" ? "payable" : "receivable", invoiceNumber: { equals: values.invoice_number, mode: "insensitive" } } });
        if (!inv) errors.push(`Invoice “${values.invoice_number}” not found for this ${role}`);
        else if (inv.lifecycle !== "open") errors.push(`Invoice ${inv.invoiceNumber} is ${inv.lifecycle}`);
        else {
          values.__invoiceId = inv.id;
          if (alloc !== null && amount !== null && alloc > amount) errors.push("Allocated amount exceeds the payment amount");
          if (alloc !== null && alloc > paise(inv.outstandingAmount)) errors.push(`Allocation exceeds ${inv.invoiceNumber}'s outstanding balance (${formatINR(paise(inv.outstandingAmount))})`);
          if (alloc !== null) values.__alloc = toDecimalString(alloc);
        }
      }
      if (party && amount !== null && date) {
        const k = `${party.id}:${date}:${amount}:${(values.reference || "").toLowerCase()}`;
        if (seen.has(k)) duplicate = `Same as row ${seen.get(k)} in this file`;
        else seen.set(k, i + 2);
        if (!duplicate) {
          const existing = await tx.payment.findFirst({
            where: { counterpartyId: party.id, amount: toDecimalString(amount), paymentDate: new Date(date + "T00:00:00Z"), status: "active", ...(values.reference ? { reference: { equals: values.reference, mode: "insensitive" } } : {}) },
          });
          if (existing) duplicate = "A payment with the same party, date, amount and reference already exists";
        }
      }
    }
    out.push({ rowNumber: i + 2, values, errors, duplicate });
  }
  return out;
}

export async function previewImport(ctx: TenantContext, type: ImportType, csvText: string, mapping: Record<string, string> | null) {
  assertCan(ctx, "imports.run");
  const { headers, rows } = parseCsv(csvText);
  if (rows.length === 0) throw new AppError("The file has no data rows.");
  const map = mapping ?? autoMap(type, headers);
  const fileHash = createHash("sha256").update(type + "\n" + csvText).digest("hex");
  return withTenant(ctx.businessId, async (tx) => {
    const previous = await tx.importBatch.findFirst({ where: { type, fileHash, status: "completed" } });
    const results = await validateRows(tx, ctx, type, rows, map);
    return {
      headers,
      mapping: map,
      results: results.map((r) => ({ ...r, values: Object.fromEntries(Object.entries(r.values).filter(([k]) => !k.startsWith("__"))) })),
      alreadyImported: previous ? { at: previous.completedAt?.toISOString() ?? previous.createdAt.toISOString(), created: previous.createdRows } : null,
    };
  });
}

/**
 * Imports the valid, non-duplicate rows the user kept. Each row runs inside a
 * savepoint, so one failure cannot leave a half-imported row; every row's
 * outcome (created / skipped / failed with reasons) is stored.
 */
export async function commitImport(ctx: TenantContext, type: ImportType, csvText: string, fileName: string, mapping: Record<string, string>, skipRowNumbers: number[]) {
  assertCan(ctx, "imports.run");
  if (type === "customers" || type === "receivables") assertCan(ctx, "receivables.manage");
  if (type === "suppliers" || type === "payables") assertCan(ctx, "payables.manage");
  if (type === "payments") assertCan(ctx, "payments.record");
  const { rows } = parseCsv(csvText);
  const fileHash = createHash("sha256").update(type + "\n" + csvText).digest("hex");
  const skip = new Set(skipRowNumbers);

  return withTenant(ctx.businessId, async (tx) => {
    const previous = await tx.importBatch.findFirst({ where: { type, fileHash, status: "completed" } });
    if (previous) throw new AppError("This exact file was already imported. Nothing was imported again.");
    const batch = await tx.importBatch.create({ data: { businessId: ctx.businessId, type, fileName: fileName.slice(0, 200), fileHash, totalRows: rows.length, mapping, createdById: ctx.userId } });
    const results = await validateRows(tx, ctx, type, rows, mapping);
    let created = 0, skipped = 0, failed = 0;
    for (const r of results) {
      const raw = rows[r.rowNumber - 2];
      if (skip.has(r.rowNumber)) {
        skipped++;
        await tx.importRow.create({ data: { businessId: ctx.businessId, batchId: batch.id, rowNumber: r.rowNumber, raw, outcome: "skipped_by_user" } });
        continue;
      }
      if (r.duplicate) {
        skipped++;
        await tx.importRow.create({ data: { businessId: ctx.businessId, batchId: batch.id, rowNumber: r.rowNumber, raw, outcome: "skipped_duplicate", errors: [r.duplicate] } });
        continue;
      }
      if (r.errors.length) {
        failed++;
        await tx.importRow.create({ data: { businessId: ctx.businessId, batchId: batch.id, rowNumber: r.rowNumber, raw, outcome: "failed", errors: r.errors } });
        continue;
      }
      await tx.$executeRawUnsafe("SAVEPOINT import_row");
      try {
        const entityId = await importRow(tx, ctx, type, r.values, batch.id);
        await tx.$executeRawUnsafe("RELEASE SAVEPOINT import_row");
        created++;
        await tx.importRow.create({ data: { businessId: ctx.businessId, batchId: batch.id, rowNumber: r.rowNumber, raw, outcome: "created", entityId } });
      } catch (e) {
        await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT import_row");
        failed++;
        const msg = e instanceof AppError ? e.message : e instanceof Error ? e.message.split("\n").pop()!.slice(0, 200) : "Unknown error";
        await tx.importRow.create({ data: { businessId: ctx.businessId, batchId: batch.id, rowNumber: r.rowNumber, raw, outcome: "failed", errors: [msg] } });
      }
    }
    await tx.importBatch.update({ where: { id: batch.id }, data: { status: "completed", createdRows: created, skippedRows: skipped, failedRows: failed, completedAt: new Date() } });
    await audit(tx, {
      businessId: ctx.businessId,
      actorUserId: ctx.userId,
      action: "import.completed",
      entityType: "import",
      entityId: batch.id,
      summary: `Imported ${IMPORT_TYPES.find((t) => t.type === type)!.label.toLowerCase()} from ${fileName}: ${created} created, ${skipped} skipped, ${failed} failed`,
    });
    return { batchId: batch.id, created, skipped, failed, total: rows.length };
  });
}

async function importRow(tx: Tx, ctx: TenantContext, type: ImportType, v: Record<string, string>, batchId: string): Promise<string> {
  if (type === "customers" || type === "suppliers") {
    if (v.__existingId) {
      await tx.counterparty.update({ where: { id: v.__existingId }, data: type === "customers" ? { isCustomer: true, customerCreditDays: v.credit_days ? Number(v.credit_days) : undefined } : { isSupplier: true, supplierCreditDays: v.credit_days ? Number(v.credit_days) : undefined } });
      return v.__existingId;
    }
    const cp = await createCounterpartyTx(
      tx,
      ctx,
      {
        name: v.name,
        contactPerson: v.contact_person,
        phone: v.phone,
        email: v.email,
        gstin: v.gstin,
        accountCode: v.account_code,
        isCustomer: type === "customers" ? "on" : undefined,
        isSupplier: type === "suppliers" ? "on" : undefined,
        customerCreditDays: type === "customers" ? v.credit_days : undefined,
        supplierCreditDays: type === "suppliers" ? v.credit_days : undefined,
        paymentTerms: v.payment_terms,
        creditLimit: v.credit_limit,
        billingAddress: v.billing_address,
        notes: v.notes,
      },
      { importBatchId: batchId },
    );
    return cp.id;
  }
  if (type === "receivables" || type === "payables") {
    const invoiceDate = parseFlexibleDate(v.invoice_date)!;
    const dueDate = v.due_date ? parseFlexibleDate(v.due_date)! : undefined;
    const total = parseAmount(v.total_amount);
    const tax = v.tax_amount ? parseAmount(v.tax_amount) : null;
    const inv = await createInvoiceTx(
      tx,
      ctx,
      type === "receivables" ? "receivable" : "payable",
      {
        counterpartyId: v.__partyId,
        invoiceNumber: v.invoice_number,
        invoiceDate,
        creditDays: v.credit_days,
        dueDateMode: dueDate ? "manual" : "calculated",
        dueDate,
        totalAmount: toDecimalString(total),
        taxAmount: tax !== null ? toDecimalString(tax) : undefined,
        subtotalAmount: tax !== null ? toDecimalString(total - tax) : undefined,
        poReference: v.po_reference,
        deliveryReference: v.delivery_reference,
        notes: v.notes,
      },
      { importBatchId: batchId },
    );
    return inv.id;
  }
  const p = await recordPaymentTx(
    tx,
    ctx,
    {
      direction: v.direction.toLowerCase() === "made" ? "made" : "received",
      counterpartyId: v.__partyId,
      amount: v.amount,
      paymentDate: parseFlexibleDate(v.payment_date)!,
      method: v.method,
      reference: v.reference,
      notes: [v.notes, "Imported"].filter(Boolean).join(" — "),
      allocations: v.__invoiceId ? [{ invoiceId: v.__invoiceId, amount: v.__alloc }] : [],
    },
    { importBatchId: batchId },
  );
  return p.id;
}

export async function importHistory(ctx: TenantContext) {
  assertCan(ctx, "imports.run");
  return withTenant(ctx.businessId, async (tx) => tx.importBatch.findMany({ orderBy: { createdAt: "desc" }, take: 30, include: { rows: { where: { outcome: { not: "created" } }, orderBy: { rowNumber: "asc" }, take: 200 } } }));
}
