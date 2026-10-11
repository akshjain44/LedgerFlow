"use client";

import Link from "next/link";
import { ActionForm, Checkbox, Field, Input, Select, SubmitButton, Textarea } from "@/components/forms";
import { createCounterpartyAction, updateCounterpartyAction } from "@/actions/counterparties";
import { buttonClass } from "@/components/ui";

export interface AccountValues {
  id?: string;
  name?: string;
  contactPerson?: string | null;
  phone?: string | null;
  email?: string | null;
  billingAddress?: string | null;
  gstin?: string | null;
  accountCode?: string | null;
  isCustomer?: boolean;
  isSupplier?: boolean;
  customerCreditDays?: number | null;
  supplierCreditDays?: number | null;
  paymentTerms?: string | null;
  creditLimit?: string | null;
  status?: string;
  assignedUserId?: string | null;
  notes?: string | null;
}

export function AccountForm({ kind, values = {}, members, canCustomer, canSupplier }: { kind: "customer" | "supplier"; values?: AccountValues; members: { id: string; name: string }[]; canCustomer: boolean; canSupplier: boolean }) {
  const editing = !!values.id;
  return (
    <ActionForm action={editing ? updateCounterpartyAction : createCounterpartyAction} className="space-y-6">
      <input type="hidden" name="kind" value={kind} />
      {editing && <input type="hidden" name="id" value={values.id} />}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Business name" name="name" required className="lg:col-span-2"><Input name="name" defaultValue={values.name} required /></Field>
        <Field label="Internal account code" name="accountCode" hint="Optional, unique. Useful for imports."><Input name="accountCode" defaultValue={values.accountCode ?? ""} /></Field>
        <Field label="Contact person" name="contactPerson"><Input name="contactPerson" defaultValue={values.contactPerson ?? ""} /></Field>
        <Field label="Phone" name="phone" hint="Used for click-to-call."><Input name="phone" type="tel" defaultValue={values.phone ?? ""} placeholder="+91 98xxx xxxxx" /></Field>
        <Field label="Email" name="email"><Input name="email" type="email" defaultValue={values.email ?? ""} /></Field>
        <Field label="GSTIN (optional)" name="gstin" hint="Format is checked; registration status is not verified."><Input name="gstin" defaultValue={values.gstin ?? ""} /></Field>
        <Field label="Billing address" name="billingAddress" className="sm:col-span-2"><Textarea name="billingAddress" rows={2} defaultValue={values.billingAddress ?? ""} /></Field>
      </section>
      <fieldset className="space-y-2">
        <legend className="mb-1 text-[13px] font-medium text-ink-2">This account is a…</legend>
        {canCustomer && <Checkbox name="isCustomer" label="Customer (they owe us)" defaultChecked={values.isCustomer ?? kind === "customer"} />}
        {canSupplier && <Checkbox name="isSupplier" label="Supplier (we owe them)" defaultChecked={values.isSupplier ?? kind === "supplier"} hint="One record can be both — no duplicate entries needed." />}
        {!canCustomer && values.isCustomer && <input type="hidden" name="isCustomer" value="on" />}
        {!canSupplier && values.isSupplier && <input type="hidden" name="isSupplier" value="on" />}
      </fieldset>
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Customer credit period (days)" name="customerCreditDays" hint="Blank uses the business default."><Input name="customerCreditDays" type="number" min={0} max={365} defaultValue={values.customerCreditDays ?? ""} /></Field>
        <Field label="Supplier payment period (days)" name="supplierCreditDays" hint="Blank uses the business default."><Input name="supplierCreditDays" type="number" min={0} max={365} defaultValue={values.supplierCreditDays ?? ""} /></Field>
        <Field label="Payment terms" name="paymentTerms"><Input name="paymentTerms" defaultValue={values.paymentTerms ?? ""} placeholder="Net 30" /></Field>
        <Field label="Approved credit limit (₹)" name="creditLimit" hint="Optional. Shown for human review; never enforced automatically."><Input name="creditLimit" inputMode="decimal" defaultValue={values.creditLimit ?? ""} /></Field>
        <Field label="Account status" name="status"><Select name="status" defaultValue={values.status ?? "active"}><option value="active">Active</option><option value="on_hold">On hold</option><option value="inactive">Inactive</option></Select></Field>
        <Field label="Assigned employee" name="assignedUserId"><Select name="assignedUserId" defaultValue={values.assignedUserId ?? ""}><option value="">Unassigned</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></Field>
        <Field label="Notes" name="notes" className="sm:col-span-2 lg:col-span-3"><Textarea name="notes" rows={2} defaultValue={values.notes ?? ""} /></Field>
      </section>
      <div className="flex gap-2">
        <SubmitButton>{editing ? "Save changes" : `Add ${kind}`}</SubmitButton>
        <Link href={editing ? `/${kind}s/${values.id}` : `/${kind}s`} className={buttonClass("ghost")}>Cancel</Link>
      </div>
    </ActionForm>
  );
}
