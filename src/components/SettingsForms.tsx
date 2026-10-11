"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ActionForm, Checkbox, Field, Input, Select, SubmitButton, Textarea } from "./forms";
import { updateBusinessAction, updateRemindersAction, updateFinancialAction, inviteMemberAction, updateMemberAction, runRemindersNowAction } from "@/actions/settings";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function BusinessForm({ b, disabled }: { b: { name: string; legalName: string | null; businessType: string | null; gstin: string | null; address: string | null; contactEmail: string | null; contactPhone: string | null; timezone: string; defaultCustomerCreditDays: number; defaultSupplierCreditDays: number }; disabled: boolean }) {
  return (
    <ActionForm action={updateBusinessAction} className="space-y-4">
      <fieldset disabled={disabled} className="grid gap-4 sm:grid-cols-2">
        <Field label="Business name" name="name" required><Input name="name" defaultValue={b.name} /></Field>
        <Field label="Legal / display name" name="legalName"><Input name="legalName" defaultValue={b.legalName ?? ""} /></Field>
        <Field label="Business type" name="businessType"><Input name="businessType" defaultValue={b.businessType ?? ""} /></Field>
        <Field label="GSTIN (optional)" name="gstin"><Input name="gstin" defaultValue={b.gstin ?? ""} /></Field>
        <Field label="Contact email" name="contactEmail"><Input name="contactEmail" type="email" defaultValue={b.contactEmail ?? ""} /></Field>
        <Field label="Contact phone" name="contactPhone"><Input name="contactPhone" defaultValue={b.contactPhone ?? ""} /></Field>
        <Field label="Registered address" name="address" className="sm:col-span-2"><Textarea name="address" rows={2} defaultValue={b.address ?? ""} /></Field>
        <Field label="Currency" name="currency"><Select name="currency" defaultValue="INR"><option value="INR">INR (₹)</option></Select></Field>
        <Field label="Timezone" name="timezone" hint="Due dates and “today” are evaluated in this timezone."><Input name="timezone" defaultValue={b.timezone} /></Field>
        <Field label="Default customer credit period (days)" name="defaultCustomerCreditDays"><Input name="defaultCustomerCreditDays" type="number" defaultValue={b.defaultCustomerCreditDays} /></Field>
        <Field label="Default supplier payment period (days)" name="defaultSupplierCreditDays"><Input name="defaultSupplierCreditDays" type="number" defaultValue={b.defaultSupplierCreditDays} /></Field>
      </fieldset>
      {!disabled && <SubmitButton>Save</SubmitButton>}
    </ActionForm>
  );
}

export function RemindersForm({ s, disabled }: { s: { workingDays: number[]; reminderStartHour: number; reminderEndHour: number; receivableReminderOffsets: number[]; payableReminderOffsets: number[]; remindersEnabled: boolean; emailNotificationsEnabled: boolean; brokenPromiseThreshold: number; brokenPromiseWindowDays: number; financeManagerOverdueDays: number; disputeReviewDays: number; disputePolicy: string }; disabled: boolean }) {
  return (
    <ActionForm action={updateRemindersAction} className="min-w-0 space-y-5">
      <fieldset disabled={disabled} className="min-w-0 space-y-5">
        <div className="space-y-2">
          <Checkbox name="remindersEnabled" defaultChecked={s.remindersEnabled} label="Generate reminder schedules for invoices and bills" />
          <Checkbox name="emailNotificationsEnabled" defaultChecked={s.emailNotificationsEnabled} label="Also email reminders to employees (requires an email provider)" hint="In-app notifications are always created." />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Receivable reminder days (relative to due date)" name="receivableReminderOffsets" hint="Negative = before, 0 = on the due date, positive = after. e.g. -3, -1, 0, 1, 3, 7"><Input name="receivableReminderOffsets" defaultValue={s.receivableReminderOffsets.join(", ")} /></Field>
          <Field label="Payable reminder days" name="payableReminderOffsets" hint="e.g. -3, -1, 0, 1, 7"><Input name="payableReminderOffsets" defaultValue={s.payableReminderOffsets.join(", ")} /></Field>
        </div>
        <fieldset>
          <legend className="mb-1 text-[13px] font-medium text-ink-2">Working days (reminders are delivered only on these days)</legend>
          <div className="flex flex-wrap gap-3">{DAYS.map((d, i) => <Checkbox key={d} name="workingDays" value={String(i + 1)} label={d} defaultChecked={s.workingDays.includes(i + 1)} />)}</div>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Deliver from (hour)" name="reminderStartHour"><Input name="reminderStartHour" type="number" min={0} max={23} defaultValue={s.reminderStartHour} /></Field>
          <Field label="Until (hour)" name="reminderEndHour" hint="Outside these hours deliveries wait."><Input name="reminderEndHour" type="number" min={1} max={24} defaultValue={s.reminderEndHour} /></Field>
          <Field label="Notify finance managers after (days overdue)" name="financeManagerOverdueDays"><Input name="financeManagerOverdueDays" type="number" min={0} defaultValue={s.financeManagerOverdueDays} /></Field>
          <Field label="Flag quiet disputes after (days)" name="disputeReviewDays"><Input name="disputeReviewDays" type="number" min={1} defaultValue={s.disputeReviewDays} /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Escalate to owner after N broken promises" name="brokenPromiseThreshold" hint="Default 2."><Input name="brokenPromiseThreshold" type="number" min={1} max={10} defaultValue={s.brokenPromiseThreshold} /></Field>
          <Field label="…within this many days" name="brokenPromiseWindowDays"><Input name="brokenPromiseWindowDays" type="number" min={7} max={365} defaultValue={s.brokenPromiseWindowDays} /></Field>
          <Field label="Disputed accounts in the collections queue" name="disputePolicy">
            <Select name="disputePolicy" defaultValue={s.disputePolicy}><option value="continue">Keep collecting (show the dispute)</option><option value="hold">De-prioritise while any dispute is open</option></Select>
          </Field>
        </div>
      </fieldset>
      {!disabled && <SubmitButton>Save reminder settings</SubmitButton>}
    </ActionForm>
  );
}

export function RunRemindersButton() {
  return (
    <ActionForm action={runRemindersNowAction}>
      <SubmitButton variant="secondary">Run reminder processor now</SubmitButton>
    </ActionForm>
  );
}

export function FinancialForm({ methods, prefix, weights, disabled }: { methods: string[]; prefix: string | null; weights: string; disabled: boolean }) {
  return (
    <ActionForm action={updateFinancialAction} className="space-y-4">
      <fieldset disabled={disabled} className="space-y-4">
        <Field label="Payment methods (one per line)" name="paymentMethods"><Textarea name="paymentMethods" rows={6} defaultValue={methods.join("\n")} /></Field>
        <Field label="Invoice number prefix (for reference)" name="invoicePrefix" hint="Shown as a placeholder hint; invoice numbers are entered as issued by your billing software."><Input name="invoicePrefix" defaultValue={prefix ?? ""} /></Field>
        <Field label="Collections priority weights (JSON, advanced)" name="priorityWeights" hint="Override any default weight, e.g. {&quot;brokenPromise&quot;: 35, &quot;neverContacted&quot;: 30}. Leave empty for defaults."><Textarea name="priorityWeights" rows={4} defaultValue={weights} className="font-mono text-[12.5px]" /></Field>
      </fieldset>
      {!disabled && <SubmitButton>Save</SubmitButton>}
    </ActionForm>
  );
}

const PERMS: [string, string][] = [
  ["receivables.view", "View receivables & customers"], ["receivables.manage", "Create/edit invoices & customers"], ["payables.view", "View payables & suppliers"], ["payables.manage", "Create/edit bills & suppliers"],
  ["payments.record", "Record payments"], ["payments.reverse", "Reverse payments / adjustments"], ["invoices.void", "Void invoices"], ["invoices.override_duplicate", "Override duplicate numbers"],
  ["collections.work", "Calls, promises, follow-ups, disputes"], ["documents.manage", "Upload documents"], ["reports.view", "View reports"], ["exports.run", "Export CSV"], ["imports.run", "Import CSV"], ["audit.view", "View audit log"],
];

export function InviteForm({ isOwner }: { isOwner: boolean }) {
  const [role, setRole] = useState("staff");
  const [link, setLink] = useState<string | null>(null);
  return (
    <ActionForm action={inviteMemberAction} resetOnSuccess onSuccess={(r) => setLink(r.ok ? ((r.data as { result?: { link?: string } } | undefined)?.result?.link ?? null) : null)} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_200px_auto] sm:items-end">
        <Field label="Email" name="email" required><Input name="email" type="email" required /></Field>
        <Field label="Role" name="role">
          <Select name="role" value={role} onChange={(e) => setRole(e.target.value)}>
            {isOwner && <option value="owner">Owner / Admin</option>}
            <option value="finance_manager">Finance Manager</option>
            <option value="staff">Staff</option>
          </Select>
        </Field>
        <SubmitButton>Invite</SubmitButton>
      </div>
      {role === "staff" && (
        <fieldset>
          <legend className="mb-1 text-[13px] font-medium text-ink-2">Staff permissions</legend>
          <div className="grid gap-1 sm:grid-cols-2">{PERMS.map(([k, l]) => <Checkbox key={k} name="permissions" value={k} label={l} defaultChecked={["receivables.view", "collections.work", "documents.manage"].includes(k)} />)}</div>
        </fieldset>
      )}
      {link && (
        <div className="rounded-md border border-[#cddaf1] bg-accent-soft p-3 text-[13px]">
          <p className="font-medium">Invitation link (valid 7 days, shown once):</p>
          <div className="mt-1 flex gap-2"><input readOnly value={link} className="h-8 flex-1 rounded border border-line-strong bg-surface px-2 font-mono text-[12px]" aria-label="Invitation link" /><button type="button" className="rounded border border-line-strong bg-surface px-2" onClick={() => navigator.clipboard.writeText(link).then(() => toast.success("Copied"))}>Copy</button></div>
        </div>
      )}
    </ActionForm>
  );
}

export function MemberEditForm({ m, canEditOwner }: { m: { id: string; role: string; status: string; permissions: string[] }; canEditOwner: boolean }) {
  const [role, setRole] = useState(m.role);
  return (
    <ActionForm action={updateMemberAction} className="space-y-3">
      <input type="hidden" name="id" value={m.id} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Role" name="role">
          <Select name="role" value={role} onChange={(e) => setRole(e.target.value)}>
            {(canEditOwner || m.role === "owner") && <option value="owner">Owner / Admin</option>}
            <option value="finance_manager">Finance Manager</option>
            <option value="staff">Staff</option>
          </Select>
        </Field>
        <Field label="Account status" name="status"><Select name="status" defaultValue={m.status}><option value="active">Active</option><option value="suspended">Suspended</option></Select></Field>
      </div>
      {role === "staff" && <div className="grid gap-1 sm:grid-cols-2">{PERMS.map(([k, l]) => <Checkbox key={k} name="permissions" value={k} label={l} defaultChecked={m.permissions.includes(k)} />)}</div>}
      <SubmitButton size="sm">Save member</SubmitButton>
    </ActionForm>
  );
}
