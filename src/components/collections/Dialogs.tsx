"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ActionForm, Checkbox, Dialog, DialogCancel, Field, Input, Select, SubmitButton, Textarea } from "@/components/forms";
import { logCallAction, createPromiseAction, createFollowUpAction, createDisputeAction, updateDisputeAction, schedulePaymentAction, reschedulePaymentAction, completeFollowUpAction, rescheduleFollowUpAction, reviewPromiseAction } from "@/actions/collections";
import { uploadDocumentAction, renderTemplateAction, sendMessageAction } from "@/actions/misc";
import { addAdjustmentAction } from "@/actions/invoices";
import { reallocateAction } from "@/actions/payments";

export interface InvoiceOption { id: string; invoiceNumber: string; outstanding: string; dueDate: string }

const OUTCOMES: { value: string; label: string; note: boolean }[] = [
  { value: "no_answer", label: "No answer", note: false },
  { value: "unavailable", label: "Customer unavailable", note: false },
  { value: "payment_promised", label: "Payment promised", note: false },
  { value: "part_payment_received", label: "Part payment received", note: true },
  { value: "payment_completed", label: "Payment completed", note: true },
  { value: "invoice_dispute", label: "Invoice dispute raised", note: true },
  { value: "delivery_dispute", label: "Delivery or quantity dispute", note: true },
  { value: "rate_discrepancy", label: "Rate discrepancy", note: true },
  { value: "cash_flow_difficulty", label: "Temporary cash-flow difficulty", note: true },
  { value: "extension_requested", label: "Requested extension", note: true },
  { value: "refused", label: "Refused to pay", note: true },
  { value: "wrong_contact", label: "Wrong contact details", note: true },
  { value: "escalated", label: "Escalated to manager", note: true },
  { value: "other", label: "Other", note: true },
];

const DISPUTE_CATEGORIES = [
  ["quantity_mismatch", "Quantity mismatch"], ["rate_mismatch", "Rate mismatch"], ["missing_delivery_docs", "Missing delivery documentation"], ["damaged_goods", "Damaged goods"],
  ["invoice_discrepancy", "Invoice discrepancy"], ["tax_discrepancy", "Tax / GST discrepancy"], ["allocation_discrepancy", "Payment allocation discrepancy"], ["other", "Other"],
];

function InvoicePicker({ invoices, defaultSelected, name = "invoiceIds", label = "Related invoices" }: { invoices: InvoiceOption[]; defaultSelected?: string[]; name?: string; label?: string }) {
  if (invoices.length === 0) return null;
  return (
    <fieldset>
      <legend className="mb-1 text-[13px] font-medium text-ink-2">{label}</legend>
      <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-line p-2">
        {invoices.map((i) => (
          <Checkbox key={i.id} name={name} value={i.id} defaultChecked={defaultSelected?.includes(i.id)} label={<span>{i.invoiceNumber} <span className="text-muted">· ₹{i.outstanding} due {i.dueDate}</span></span>} />
        ))}
      </div>
    </fieldset>
  );
}

export function LogCallDialog({ counterpartyId, invoices, defaultInvoiceIds, followUpId, today, isCustomer = true, contactPerson, triggerLabel = "Record call", triggerVariant = "primary", triggerSize = "md" }: { counterpartyId: string; invoices: InvoiceOption[]; defaultInvoiceIds?: string[]; followUpId?: string; today: string; isCustomer?: boolean; contactPerson?: string | null; triggerLabel?: string; triggerVariant?: "primary" | "secondary" | "subtle"; triggerSize?: "sm" | "md" }) {
  const [outcome, setOutcome] = useState("");
  const [channel, setChannel] = useState("call");
  const def = OUTCOMES.find((o) => o.value === outcome);
  const disputeOutcome = ["invoice_dispute", "delivery_dispute", "rate_discrepancy"].includes(outcome);
  return (
    <Dialog trigger={triggerLabel} title={isCustomer ? "Record customer contact" : "Record supplier communication"} description="Record what was said. The note is kept on the account timeline." triggerVariant={triggerVariant} triggerSize={triggerSize}>
      <ActionForm action={logCallAction} className="space-y-3">
        <input type="hidden" name="counterpartyId" value={counterpartyId} />
        {followUpId && <input type="hidden" name="followUpId" value={followUpId} />}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Channel" name="channel">
            <Select name="channel" value={channel} onChange={(e) => setChannel(e.target.value)}>
              <option value="call">Phone call</option><option value="whatsapp">WhatsApp</option><option value="email">Email</option><option value="visit">Visit</option><option value="sms">SMS</option><option value="note">Internal note</option>
            </Select>
          </Field>
          <Field label="Direction" name="direction">
            <Select name="direction" defaultValue="outbound"><option value="outbound">We contacted them</option><option value="inbound">They contacted us</option></Select>
          </Field>
        </div>
        <Field label="Outcome" name="outcome" required={channel === "call"}>
          <Select name="outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            <option value="">Select outcome…</option>
            {OUTCOMES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </Field>
        <Field label="Spoke with" name="contactPerson"><Input name="contactPerson" defaultValue={contactPerson ?? ""} /></Field>
        <InvoicePicker invoices={invoices} defaultSelected={defaultInvoiceIds} />
        <Field label="Notes — explanation, commitments, what was agreed" name="notes" required={def?.note}>
          <Textarea name="notes" rows={3} />
        </Field>
        {outcome === "payment_promised" && (
          <div className="grid gap-3 rounded-md border border-[#cddaf1] bg-accent-soft/50 p-3 sm:grid-cols-2">
            <Field label="Promised amount (₹)" name="promiseAmount" required><Input name="promiseAmount" inputMode="decimal" /></Field>
            <Field label="Promised date" name="promiseDate" required><Input name="promiseDate" type="date" min={today} /></Field>
            <Field label="Reason given" name="promiseReason" className="sm:col-span-2"><Input name="promiseReason" /></Field>
            <p className="text-[12.5px] text-muted sm:col-span-2">A promise is not a payment. It is checked against actual payments after the promised date.</p>
          </div>
        )}
        {disputeOutcome && (
          <div className="grid gap-3 rounded-md border border-[#f0dcb4] bg-warn-soft/60 p-3">
            <Field label="Dispute category" name="disputeCategory">
              <Select name="disputeCategory" defaultValue={outcome === "delivery_dispute" ? "quantity_mismatch" : outcome === "rate_discrepancy" ? "rate_mismatch" : "invoice_discrepancy"}>
                {DISPUTE_CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </Field>
            <Field label="Dispute details" name="disputeDescription"><Textarea name="disputeDescription" rows={2} /></Field>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Next action date" name="nextActionDate" hint="Optional: schedules a follow-up."><Input name="nextActionDate" type="date" min={today} /></Field>
          <Field label="Next action" name="nextActionType"><Select name="nextActionType" defaultValue="call"><option value="call">Call</option><option value="email">Email</option><option value="visit">Visit</option><option value="review">Internal review</option><option value="other">Other</option></Select></Field>
        </div>
        <div className="flex justify-end gap-2 pt-1"><DialogCancel /><SubmitButton>Save</SubmitButton></div>
      </ActionForm>
    </Dialog>
  );
}

export function PromiseDialog({ counterpartyId, invoices, defaultInvoiceIds, today, triggerSize = "md" }: { counterpartyId: string; invoices: InvoiceOption[]; defaultInvoiceIds?: string[]; today: string; triggerSize?: "sm" | "md" }) {
  return (
    <Dialog trigger="Log promise to pay" title="Promise to pay" description="Record exactly what the customer committed to. It is never treated as a payment." triggerSize={triggerSize}>
      <ActionForm action={createPromiseAction} className="space-y-3">
        <input type="hidden" name="counterpartyId" value={counterpartyId} />
        <InvoicePicker invoices={invoices} defaultSelected={defaultInvoiceIds} label="Invoices covered by the promise" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Amount promised (₹)" name="amount" required><Input name="amount" inputMode="decimal" required /></Field>
          <Field label="Promised payment date" name="promisedDate" required><Input name="promisedDate" type="date" min={today} required /></Field>
          <Field label="Follow-up date" name="followUpDate" hint="Defaults to the promised date."><Input name="followUpDate" type="date" min={today} /></Field>
        </div>
        <Checkbox name="isFullPayment" label="This promise covers the full outstanding balance of the selected invoices" />
        <Field label="Customer's stated reason / context" name="reason"><Textarea name="reason" rows={2} /></Field>
        <div className="flex justify-end gap-2"><DialogCancel /><SubmitButton>Record promise</SubmitButton></div>
      </ActionForm>
    </Dialog>
  );
}

export function FollowUpDialog({ counterpartyId, invoiceId, members, today, defaultTitle, triggerSize = "md", triggerVariant = "secondary" }: { counterpartyId: string; invoiceId?: string; members: { id: string; name: string }[]; today: string; defaultTitle: string; triggerSize?: "sm" | "md"; triggerVariant?: "secondary" | "subtle" }) {
  return (
    <Dialog trigger="Schedule follow-up" title="Schedule a follow-up" triggerSize={triggerSize} triggerVariant={triggerVariant}>
      <ActionForm action={createFollowUpAction} className="space-y-3">
        <input type="hidden" name="counterpartyId" value={counterpartyId} />
        {invoiceId && <input type="hidden" name="invoiceId" value={invoiceId} />}
        <Field label="What needs to happen" name="title" required><Input name="title" defaultValue={defaultTitle} required /></Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Type" name="type"><Select name="type" defaultValue="call"><option value="call">Call</option><option value="email">Email</option><option value="visit">Visit</option><option value="review">Review</option><option value="payment_planning">Payment planning</option><option value="other">Other</option></Select></Field>
          <Field label="Due" name="dueDate" required><Input name="dueDate" type="date" defaultValue={today} min={today} required /></Field>
          <Field label="Priority" name="priority"><Select name="priority" defaultValue="normal"><option value="urgent">Urgent</option><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option></Select></Field>
        </div>
        <Field label="Assign to" name="assignedUserId"><Select name="assignedUserId" defaultValue=""><option value="">Account owner (default)</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></Field>
        <Field label="Details" name="details"><Textarea name="details" rows={2} /></Field>
        <div className="flex justify-end gap-2"><DialogCancel /><SubmitButton>Schedule</SubmitButton></div>
      </ActionForm>
    </Dialog>
  );
}

export function DisputeDialog({ invoiceId, members, policyHold, triggerSize = "md" }: { invoiceId: string; members: { id: string; name: string }[]; policyHold?: boolean; triggerSize?: "sm" | "md" }) {
  return (
    <Dialog trigger="Mark dispute" title="Record a dispute" description="The invoice stays visible and keeps its overdue status. Collections continue unless you document a hold." triggerSize={triggerSize}>
      <ActionForm action={createDisputeAction} className="space-y-3">
        <input type="hidden" name="invoiceId" value={invoiceId} />
        <Field label="Category" name="category" required><Select name="category" defaultValue="">{[<option key="" value="" disabled>Select…</option>, ...DISPUTE_CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)]}</Select></Field>
        <Field label="Description" name="description" required><Textarea name="description" rows={3} required /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Disputed amount (₹)" name="disputedAmount" hint="Optional."><Input name="disputedAmount" inputMode="decimal" /></Field>
          <Field label="Responsible employee" name="assignedUserId"><Select name="assignedUserId" defaultValue=""><option value="">Invoice owner</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></Field>
        </div>
        <Checkbox name="collectionHold" label="Put collection follow-ups on hold for this account" hint={policyHold ? "Business policy already de-prioritises disputed accounts." : "Use only with a documented reason."} />
        <Field label="Reason for hold" name="holdReason"><Input name="holdReason" /></Field>
        <p className="text-[12.5px] text-muted">Upload supporting evidence from the Documents section after saving.</p>
        <div className="flex justify-end gap-2"><DialogCancel /><SubmitButton>Save dispute</SubmitButton></div>
      </ActionForm>
    </Dialog>
  );
}

export function DisputeUpdateDialog({ disputeId, status, hold }: { disputeId: string; status: string; hold: boolean }) {
  const [s, setS] = useState(status);
  const closing = s === "resolved" || s === "closed";
  return (
    <Dialog trigger="Update" title="Update dispute" triggerSize="sm">
      <ActionForm action={updateDisputeAction} className="space-y-3">
        <input type="hidden" name="id" value={disputeId} />
        <Field label="Status" name="status" required>
          <Select name="status" value={s} onChange={(e) => setS(e.target.value)}>
            <option value="open">Open</option><option value="under_review">Under review</option><option value="awaiting_customer">Awaiting customer</option><option value="awaiting_supplier">Awaiting supplier</option><option value="awaiting_internal">Awaiting internal team</option><option value="resolved">Resolved</option><option value="closed">Closed</option>
          </Select>
        </Field>
        {closing ? (
          <Field label="Resolution notes" name="resolutionNotes" required><Textarea name="resolutionNotes" rows={3} required /></Field>
        ) : (
          <>
            <Field label="Update note" name="note"><Textarea name="note" rows={2} /></Field>
            <Checkbox name="collectionHold" defaultChecked={hold} label="Collections on hold" />
            <Field label="Reason for hold" name="holdReason"><Input name="holdReason" /></Field>
          </>
        )}
        <div className="flex justify-end gap-2"><DialogCancel /><SubmitButton>Save</SubmitButton></div>
      </ActionForm>
    </Dialog>
  );
}

export function PlannedPaymentDialog({ invoiceId, outstanding, today }: { invoiceId: string; outstanding: string; today: string }) {
  return (
    <Dialog trigger="Schedule payment" title="Plan a supplier payment" description="A plan is not a payment. Record the actual payment once it has been made.">
      <ActionForm action={schedulePaymentAction} className="space-y-3">
        <input type="hidden" name="invoiceId" value={invoiceId} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Planned date" name="plannedDate" required><Input name="plannedDate" type="date" min={today} defaultValue={today} required /></Field>
          <Field label="Amount (₹)" name="amount" required hint={`Outstanding ₹${outstanding}`}><Input name="amount" inputMode="decimal" defaultValue={outstanding.replace(/,/g, "")} required /></Field>
        </div>
        <Checkbox name="promisedToSupplier" label="This date has been communicated to the supplier" />
        <Field label="Notes" name="notes"><Textarea name="notes" rows={2} /></Field>
        <div className="flex justify-end gap-2"><DialogCancel /><SubmitButton>Plan payment</SubmitButton></div>
      </ActionForm>
    </Dialog>
  );
}

export function RescheduleDialog({ id, kind, today }: { id: string; kind: "planned" | "followup"; today: string }) {
  return (
    <Dialog trigger="Reschedule" title={kind === "planned" ? "Reschedule planned payment" : "Reschedule follow-up"} triggerSize="sm" triggerVariant="ghost">
      <ActionForm action={kind === "planned" ? reschedulePaymentAction : rescheduleFollowUpAction} className="space-y-3">
        <input type="hidden" name="id" value={id} />
        <Field label="New date" name={kind === "planned" ? "plannedDate" : "dueDate"} required><Input name={kind === "planned" ? "plannedDate" : "dueDate"} type="date" min={today} required /></Field>
        <Field label="Reason" name="reason" required={kind === "planned"}><Input name="reason" /></Field>
        <div className="flex justify-end gap-2"><DialogCancel /><SubmitButton>Reschedule</SubmitButton></div>
      </ActionForm>
    </Dialog>
  );
}

export function CompleteFollowUpDialog({ id }: { id: string }) {
  return (
    <Dialog trigger="Complete" title="Complete follow-up" triggerSize="sm" triggerVariant="subtle">
      <ActionForm action={completeFollowUpAction} className="space-y-3">
        <input type="hidden" name="id" value={id} />
        <Field label="Outcome note" name="note"><Textarea name="note" rows={2} /></Field>
        <p className="text-[12.5px] text-muted">If you spoke to the customer, use “Record call” instead so the outcome is on their timeline.</p>
        <div className="flex justify-end gap-2"><DialogCancel /><SubmitButton>Mark complete</SubmitButton></div>
      </ActionForm>
    </Dialog>
  );
}

export function ReviewPromiseDialog({ id, partial, today }: { id: string; partial: boolean; today: string }) {
  return (
    <Dialog trigger="Review" title="Review promise outcome" description="Record an authorised judgement for an ambiguous outcome (late or partial payment)." triggerSize="sm">
      <ActionForm action={reviewPromiseAction} className="space-y-3">
        <input type="hidden" name="id" value={id} />
        <Field label="Review note" name="note" required><Textarea name="note" rows={2} required /></Field>
        {partial && <Field label="Carry the unpaid remainder into a new promise dated" name="carryDate" hint="Optional."><Input name="carryDate" type="date" min={today} /></Field>}
        <div className="flex justify-end gap-2"><DialogCancel /><SubmitButton>Save review</SubmitButton></div>
      </ActionForm>
    </Dialog>
  );
}

export function UploadDialog({ invoiceId, counterpartyId, paymentId, disputeId, defaultKind = "invoice", triggerSize = "md" }: { invoiceId?: string; counterpartyId?: string; paymentId?: string; disputeId?: string; defaultKind?: string; triggerSize?: "sm" | "md" }) {
  return (
    <Dialog trigger="Upload document" title="Upload a document" description="PDF, PNG, JPEG or WebP up to 10 MB. Files are stored privately; uploading does not verify their contents." triggerSize={triggerSize}>
      <ActionForm action={uploadDocumentAction} className="space-y-3">
        {invoiceId && <input type="hidden" name="invoiceId" value={invoiceId} />}
        {counterpartyId && <input type="hidden" name="counterpartyId" value={counterpartyId} />}
        {paymentId && <input type="hidden" name="paymentId" value={paymentId} />}
        {disputeId && <input type="hidden" name="disputeId" value={disputeId} />}
        <Field label="Document type" name="kind" required>
          <Select name="kind" defaultValue={defaultKind}>
            <option value="invoice">Customer invoice</option><option value="supplier_bill">Supplier bill</option><option value="purchase_order">Purchase order</option><option value="delivery_challan">Delivery challan / proof of delivery</option><option value="payment_confirmation">Payment confirmation</option><option value="dispute_evidence">Dispute evidence</option><option value="other">Other</option>
          </Select>
        </Field>
        <Field label="File" name="file" required><input id="file" name="file" type="file" accept="application/pdf,image/png,image/jpeg,image/webp" required className="block w-full text-[13.5px]" /></Field>
        <div className="flex justify-end gap-2"><DialogCancel /><SubmitButton>Upload</SubmitButton></div>
      </ActionForm>
    </Dialog>
  );
}

const TEMPLATES = [
  ["upcoming", "Upcoming payment reminder"], ["due_today", "Payment due today"], ["overdue", "Overdue payment follow-up"], ["promise_confirm", "Confirmation of promised payment"],
  ["promise_broken", "Follow-up on missed promised payment"], ["remittance", "Request for remittance details"], ["discrepancy", "Clarify an invoice discrepancy"], ["supplier_schedule", "Supplier payment scheduling"],
];

export function MessageDialog({ counterpartyId, invoiceId, supplier, triggerSize = "md" }: { counterpartyId: string; invoiceId?: string; supplier?: boolean; triggerSize?: "sm" | "md" }) {
  const [tpl, setTpl] = useState(supplier ? "supplier_schedule" : "overdue");
  const [draft, setDraft] = useState<{ subject: string; body: string; recipient: string | null; phone: string | null; emailConfigured: boolean } | null>(null);
  const [loading, start] = useTransition();
  const load = (key: string) =>
    start(async () => {
      const r = await renderTemplateAction(key, counterpartyId, invoiceId ?? null);
      if (r.ok) setDraft(r.data);
      else toast.error(r.error);
    });
  return (
    <Dialog trigger="Prepare message" title="Prepare a message" description="Review and edit before sending. Neutral, factual wording only." wide triggerSize={triggerSize}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex-1 text-[13px] font-medium text-ink-2">Template
            <select value={tpl} onChange={(e) => setTpl(e.target.value)} className="mt-1 block h-9 w-full rounded-md border border-line-strong bg-surface px-2 text-[14px]">
              {TEMPLATES.filter(([k]) => (supplier ? k === "supplier_schedule" || k === "discrepancy" : k !== "supplier_schedule")).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <button type="button" onClick={() => load(tpl)} className="h-9 rounded-md border border-line-strong bg-surface px-3 text-sm font-medium hover:bg-subtle" disabled={loading}>{loading ? "Loading…" : "Fill template"}</button>
        </div>
        {draft && (
          <ActionForm action={sendMessageAction} className="space-y-3">
            <input type="hidden" name="counterpartyId" value={counterpartyId} />
            {invoiceId && <input type="hidden" name="invoiceId" value={invoiceId} />}
            <input type="hidden" name="templateKey" value={tpl} />
            <Field label="Recipient email" name="recipient"><Input name="recipient" type="email" defaultValue={draft.recipient ?? ""} /></Field>
            <Field label="Subject" name="subject"><Input name="subject" defaultValue={draft.subject} /></Field>
            <Field label="Message" name="body"><Textarea name="body" rows={10} defaultValue={draft.body} /></Field>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[12.5px] text-muted">{draft.emailConfigured ? "Sending emails the customer from the configured SMTP account." : "Email is not configured: copy the text into WhatsApp or your mail client. It will be logged as prepared, not sent."}</p>
              <div className="flex gap-2">
                <button
                  type="submit"
                  name="channel"
                  value="copy"
                  className="h-9 rounded-md border border-line-strong bg-surface px-3 text-sm font-medium hover:bg-subtle"
                  onClick={(e) => {
                    const form = (e.currentTarget as HTMLButtonElement).form!;
                    const body = (form.elements.namedItem("body") as HTMLTextAreaElement).value;
                    navigator.clipboard?.writeText(body).then(() => toast.success("Copied to clipboard"), () => undefined);
                    let ch = form.querySelector('input[name="channel"]') as HTMLInputElement | null;
                    if (!ch) { ch = document.createElement("input"); ch.type = "hidden"; ch.name = "channel"; form.appendChild(ch); }
                    ch.value = "copy";
                  }}
                >
                  Copy & log as prepared
                </button>
                {draft.emailConfigured && (
                  <button
                    type="submit"
                    className="h-9 rounded-md bg-accent px-3 text-sm font-medium text-white"
                    onClick={(e) => {
                      const form = (e.currentTarget as HTMLButtonElement).form!;
                      let ch = form.querySelector('input[name="channel"]') as HTMLInputElement | null;
                      if (!ch) { ch = document.createElement("input"); ch.type = "hidden"; ch.name = "channel"; form.appendChild(ch); }
                      ch.value = "email";
                    }}
                  >
                    Send email
                  </button>
                )}
              </div>
            </div>
            {draft.phone && <p className="text-[12.5px]"><a className="text-accent hover:underline" href={`https://wa.me/${draft.phone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer">Open WhatsApp chat</a> (opens WhatsApp; nothing is sent automatically)</p>}
          </ActionForm>
        )}
      </div>
    </Dialog>
  );
}

export function AdjustmentDialog({ invoiceId, today }: { invoiceId: string; today: string }) {
  return (
    <Dialog trigger="Credit note / write-off" title="Record an adjustment" description="Reduces the outstanding balance with a traceable record. Reversible.">
      <ActionForm action={addAdjustmentAction} className="space-y-3">
        <input type="hidden" name="invoiceId" value={invoiceId} />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Type" name="kind"><Select name="kind" defaultValue="credit_note"><option value="credit_note">Credit note</option><option value="write_off">Write-off</option></Select></Field>
          <Field label="Amount (₹)" name="amount" required><Input name="amount" inputMode="decimal" required /></Field>
          <Field label="Date" name="adjustmentDate" required><Input name="adjustmentDate" type="date" defaultValue={today} required /></Field>
        </div>
        <Field label="Reference" name="reference"><Input name="reference" placeholder="Credit note no." /></Field>
        <Field label="Reason" name="reason" required><Textarea name="reason" rows={2} required /></Field>
        <div className="flex justify-end gap-2"><DialogCancel /><SubmitButton>Save adjustment</SubmitButton></div>
      </ActionForm>
    </Dialog>
  );
}

export function ReallocateDialog({ allocationId, targets }: { allocationId: string; targets: InvoiceOption[] }) {
  return (
    <Dialog trigger="Reallocate" title="Move this allocation" description="The original allocation is kept as reversed; a new allocation is created." triggerSize="sm" triggerVariant="ghost">
      <ActionForm action={reallocateAction} className="space-y-3">
        <input type="hidden" name="id" value={allocationId} />
        {targets.length === 0 ? (
          <p className="text-[13.5px] text-muted">No other open invoices for this account.</p>
        ) : (
          <Field label="Move to invoice" name="toInvoiceId" required><Select name="toInvoiceId" defaultValue="">{[<option key="" value="" disabled>Select…</option>, ...targets.map((t) => <option key={t.id} value={t.id}>{t.invoiceNumber} — ₹{t.outstanding} outstanding</option>)]}</Select></Field>
        )}
        <Field label="Reason" name="reason" required><Input name="reason" required /></Field>
        <div className="flex justify-end gap-2"><DialogCancel /><SubmitButton>Move</SubmitButton></div>
      </ActionForm>
    </Dialog>
  );
}
