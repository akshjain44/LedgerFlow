"use client";

import { useMemo, useState } from "react";
import { ActionForm, Checkbox, Field, Input, Select, SubmitButton, Textarea } from "@/components/forms";
import { createInvoiceAction, updateInvoiceAction } from "@/actions/invoices";
import { buttonClass } from "@/components/ui";
import Link from "next/link";

interface Party { id: string; name: string; customerCreditDays: number | null; supplierCreditDays: number | null; paymentTerms: string | null; assignedUserId: string | null }

function addDays(iso: string, n: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const fmt = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m) - 1]} ${y}`;
};

export function InvoiceForm({
  direction,
  parties,
  members,
  today,
  defaultCreditDays,
  canOverrideDuplicate,
  initialCounterpartyId,
}: {
  direction: "receivable" | "payable";
  parties: Party[];
  members: { id: string; name: string }[];
  today: string;
  defaultCreditDays: number;
  canOverrideDuplicate: boolean;
  initialCounterpartyId?: string;
}) {
  const recv = direction === "receivable";
  const [partyId, setPartyId] = useState(initialCounterpartyId ?? "");
  const party = parties.find((p) => p.id === partyId);
  const partyDays = party ? (recv ? party.customerCreditDays : party.supplierCreditDays) : null;
  const [invoiceDate, setInvoiceDate] = useState(today);
  const [creditDays, setCreditDays] = useState<string>("");
  const [mode, setMode] = useState<"calculated" | "manual">("calculated");
  const [manualDue, setManualDue] = useState("");
  const [showDup, setShowDup] = useState(false);
  const effectiveDays = creditDays !== "" ? Number(creditDays) : partyDays ?? defaultCreditDays;
  const calculated = useMemo(() => (/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate) && Number.isInteger(effectiveDays) ? addDays(invoiceDate, effectiveDays) : null), [invoiceDate, effectiveDays]);

  return (
    <ActionForm action={createInvoiceAction} className="space-y-6">
      <input type="hidden" name="direction" value={direction} />
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label={recv ? "Customer" : "Supplier"} name="counterpartyId" required hint={parties.length === 0 ? undefined : party?.paymentTerms ? `Terms: ${party.paymentTerms}` : undefined}>
          <Select name="counterpartyId" value={partyId} onChange={(e) => setPartyId(e.target.value)} required>
            <option value="">Select…</option>
            {parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <Field label={recv ? "Invoice number" : "Supplier invoice / bill number"} name="invoiceNumber" required hint={recv ? "Must be unique in your business." : "Must be unique for this supplier."}>
          <Input name="invoiceNumber" required maxLength={60} autoComplete="off" />
        </Field>
        <Field label={recv ? "Invoice date" : "Bill date"} name="invoiceDate" required>
          <Input name="invoiceDate" type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} required />
        </Field>
        <Field label="Payment terms" name="paymentTerms" hint="Free text, e.g. “Net 30”, “50% advance”.">
          <Input name="paymentTerms" placeholder={party?.paymentTerms ?? "Net 30"} />
        </Field>
        <Field label="Credit period (days)" name="creditDays" hint={`Blank uses ${party ? `this ${recv ? "customer" : "supplier"}'s` : "the default"} ${partyDays ?? defaultCreditDays} days.`}>
          <Input name="creditDays" type="number" min={0} max={365} value={creditDays} onChange={(e) => setCreditDays(e.target.value)} />
        </Field>
        <fieldset>
          <legend className="mb-1 text-[13px] font-medium text-ink-2">Due date <span className="text-bad">*</span></legend>
          <input type="hidden" name="dueDateMode" value={mode} />
          <div className="flex gap-1 rounded-md border border-line-strong p-0.5 text-[13px]">
            <button type="button" onClick={() => setMode("calculated")} className={`flex-1 rounded px-2 py-1 ${mode === "calculated" ? "bg-ink text-white" : ""}`}>Calculated</button>
            <button type="button" onClick={() => setMode("manual")} className={`flex-1 rounded px-2 py-1 ${mode === "manual" ? "bg-ink text-white" : ""}`}>Enter date</button>
          </div>
          {mode === "calculated" ? (
            <p className="mt-1.5 text-[13px] text-ink-2">{calculated ? <>Due <strong>{fmt(calculated)}</strong> ({effectiveDays} days)</> : "Enter an invoice date"}</p>
          ) : (
            <div className="mt-1.5">
              <Field label={<span className="sr-only">Due date</span>} name="dueDate">
                <Input name="dueDate" type="date" value={manualDue} min={invoiceDate} onChange={(e) => setManualDue(e.target.value)} />
              </Field>
              <p className="mt-1 text-[12px] text-muted">An entered due date is kept as entered; it is never recalculated automatically.</p>
            </div>
          )}
        </fieldset>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <Field label="Amount before tax" name="subtotalAmount" hint="Optional.">
          <Input name="subtotalAmount" inputMode="decimal" placeholder="0.00" />
        </Field>
        <Field label="Tax (GST)" name="taxAmount" hint="Optional. If both are given, they must add up to the total.">
          <Input name="taxAmount" inputMode="decimal" placeholder="0.00" />
        </Field>
        <Field label={recv ? "Invoice total (₹)" : "Total payable (₹)"} name="totalAmount" required>
          <Input name="totalAmount" inputMode="decimal" placeholder="0.00" required />
        </Field>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Purchase order reference" name="poReference"><Input name="poReference" /></Field>
        <Field label={recv ? "Delivery challan / POD reference" : "Goods receipt / delivery reference"} name="deliveryReference"><Input name="deliveryReference" /></Field>
        <Field label="Responsible employee" name="assignedUserId" hint={`Blank uses the ${recv ? "customer" : "supplier"}'s assigned employee.`}>
          <Select name="assignedUserId" defaultValue={party?.assignedUserId ?? ""}>
            <option value="">—</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </Select>
        </Field>
        {!recv && (
          <Field label="Payment priority" name="priority">
            <Select name="priority" defaultValue="normal">
              <option value="critical">Critical — supply depends on it</option>
              <option value="high">High</option>
              <option value="normal">Normal</option>
              <option value="low">Low</option>
            </Select>
          </Field>
        )}
        {recv && (
          <Field label="Save as" name="status">
            <Select name="status" defaultValue="open">
              <option value="open">Issued (open)</option>
              <option value="draft">Draft (no reminders)</option>
            </Select>
          </Field>
        )}
        <Field label="Internal notes" name="notes" className="sm:col-span-2 lg:col-span-3"><Textarea name="notes" rows={2} /></Field>
      </section>

      <section className="space-y-2">
        <Checkbox name="remindersEnabled" value="on" defaultChecked label="Create the reminder schedule for this invoice" hint="Internal reminders to the responsible employee before and after the due date (configured in Settings → Reminders)." />
        <input type="hidden" name="remindersEnabled" value="off" />
        {canOverrideDuplicate && (
          <div>
            <button type="button" className="text-[13px] text-accent hover:underline" onClick={() => setShowDup((v) => !v)}>{showDup ? "Hide" : "Allow a duplicate invoice number…"}</button>
            {showDup && (
              <div className="mt-2 max-w-lg">
                <Field label="Reason for allowing a duplicate number" name="duplicateOverride" hint="Recorded in the audit log. Leave blank to keep the duplicate check.">
                  <Input name="duplicateOverride" />
                </Field>
              </div>
            )}
          </div>
        )}
      </section>

      <p className="text-[13px] text-muted">You can attach the invoice PDF, purchase order and delivery challan on the next screen.</p>
      <div className="flex gap-2">
        <SubmitButton>{recv ? "Save invoice" : "Save bill"}</SubmitButton>
        <Link href={recv ? "/receivables" : "/payables"} className={buttonClass("ghost")}>Cancel</Link>
      </div>
    </ActionForm>
  );
}

export function InvoiceEditForm({ inv, members, direction }: { inv: { id: string; invoiceNumber: string; invoiceDate: string; dueDate: string; paymentTerms: string | null; totalAmount: string; subtotalAmount: string | null; taxAmount: string | null; poReference: string | null; deliveryReference: string | null; notes: string | null; assignedUserId: string | null; priority: string; remindersEnabled: boolean }; members: { id: string; name: string }[]; direction: "receivable" | "payable" }) {
  const [due, setDue] = useState(inv.dueDate);
  return (
    <ActionForm action={updateInvoiceAction} className="space-y-6">
      <input type="hidden" name="id" value={inv.id} />
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Invoice number" name="invoiceNumber" required><Input name="invoiceNumber" defaultValue={inv.invoiceNumber} required /></Field>
        <Field label="Invoice date" name="invoiceDate" required><Input name="invoiceDate" type="date" defaultValue={inv.invoiceDate} required /></Field>
        <Field label="Due date" name="dueDate" required hint="Changing it reschedules future reminders."><Input name="dueDate" type="date" value={due} onChange={(e) => setDue(e.target.value)} required /></Field>
        {due !== inv.dueDate && (
          <Field label="Reason for the due-date change" name="changeReason" required className="sm:col-span-2 lg:col-span-3"><Input name="changeReason" required /></Field>
        )}
        <Field label="Payment terms" name="paymentTerms"><Input name="paymentTerms" defaultValue={inv.paymentTerms ?? ""} /></Field>
        <Field label="Amount before tax" name="subtotalAmount"><Input name="subtotalAmount" inputMode="decimal" defaultValue={inv.subtotalAmount ?? ""} /></Field>
        <Field label="Tax" name="taxAmount"><Input name="taxAmount" inputMode="decimal" defaultValue={inv.taxAmount ?? ""} /></Field>
        <Field label="Total" name="totalAmount" required hint="Cannot be lower than what has already been paid."><Input name="totalAmount" inputMode="decimal" defaultValue={inv.totalAmount} required /></Field>
        <Field label="PO reference" name="poReference"><Input name="poReference" defaultValue={inv.poReference ?? ""} /></Field>
        <Field label="Delivery reference" name="deliveryReference"><Input name="deliveryReference" defaultValue={inv.deliveryReference ?? ""} /></Field>
        <Field label="Responsible employee" name="assignedUserId">
          <Select name="assignedUserId" defaultValue={inv.assignedUserId ?? ""}>
            <option value="">—</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </Select>
        </Field>
        {direction === "payable" && (
          <Field label="Payment priority" name="priority">
            <Select name="priority" defaultValue={inv.priority}><option value="critical">Critical</option><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option></Select>
          </Field>
        )}
        <Field label="Internal notes" name="notes" className="sm:col-span-2 lg:col-span-3"><Textarea name="notes" defaultValue={inv.notes ?? ""} /></Field>
      </section>
      <Checkbox name="remindersEnabled" value="on" defaultChecked={inv.remindersEnabled} label="Reminders enabled for this invoice" />
      <input type="hidden" name="remindersEnabled" value="off" />
      <p className="text-[13px] text-muted">Payments and allocations are not changed by editing. Use reversal or reallocation on the payment to correct them.</p>
      <SubmitButton>Save changes</SubmitButton>
    </ActionForm>
  );
}
