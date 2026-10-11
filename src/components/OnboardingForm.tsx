"use client";

import { ActionForm, Checkbox, Field, Input, Select, SubmitButton, Textarea } from "./forms";
import { createBusinessAction } from "@/actions/auth";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function OnboardingForm() {
  return (
    <ActionForm action={createBusinessAction} className="space-y-6">
      <section className="space-y-4">
        <h2 className="text-[15px] font-semibold">Business</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Business name" name="name" required><Input name="name" required /></Field>
          <Field label="Legal / display name" name="legalName"><Input name="legalName" /></Field>
          <Field label="Business type" name="businessType">
            <Select name="businessType" defaultValue="Chemical distributor">
              <option>Chemical distributor</option>
              <option>Industrial materials supplier</option>
              <option>Wholesaler</option>
              <option>Other B2B trading business</option>
            </Select>
          </Field>
          <Field label="GSTIN (optional)" name="gstin" hint="Not required to use the app."><Input name="gstin" placeholder="36AABCU9603R1ZM" /></Field>
          <Field label="Contact email" name="contactEmail"><Input name="contactEmail" type="email" /></Field>
          <Field label="Contact phone" name="contactPhone"><Input name="contactPhone" type="tel" /></Field>
          <Field label="Registered address (optional)" name="address" className="sm:col-span-2"><Textarea name="address" rows={2} /></Field>
        </div>
      </section>
      <section className="space-y-4">
        <h2 className="text-[15px] font-semibold">Terms &amp; calendar</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Currency" name="currency"><Select name="currency" defaultValue="INR"><option value="INR">INR (₹)</option></Select></Field>
          <Field label="Timezone" name="timezone"><Select name="timezone" defaultValue="Asia/Kolkata"><option>Asia/Kolkata</option><option>Asia/Dubai</option><option>Asia/Singapore</option><option>Europe/London</option></Select></Field>
          <Field label="Default customer credit period (days)" name="defaultCustomerCreditDays" required><Input name="defaultCustomerCreditDays" type="number" min={0} max={365} defaultValue={30} /></Field>
          <Field label="Default supplier payment period (days)" name="defaultSupplierCreditDays" required><Input name="defaultSupplierCreditDays" type="number" min={0} max={365} defaultValue={30} /></Field>
        </div>
        <fieldset>
          <legend className="mb-1 text-[13px] font-medium text-ink-2">Working days (reminders are delivered on these days)</legend>
          <div className="flex flex-wrap gap-3">
            {DAYS.map((d, i) => <Checkbox key={d} name="workingDays" value={String(i + 1)} label={d} defaultChecked={i < 6} />)}
          </div>
        </fieldset>
        <Field label="Reminder schedule" name="reminderPreset" hint="You can fine-tune offsets, hours and escalation later in Settings.">
          <Select name="reminderPreset" defaultValue="standard">
            <option value="standard">Standard — 3 &amp; 1 days before, on the day, then 1, 3, 7, 15, 30 days after</option>
            <option value="light">Light — 1 day before, on the day, then 3, 7, 15, 30 days after</option>
          </Select>
        </Field>
      </section>
      <SubmitButton>Create business</SubmitButton>
    </ActionForm>
  );
}
