"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { ActionForm, Field, Input, Select, SubmitButton, Textarea } from "./forms";
import { recordPaymentAction, allocatePaymentAction } from "@/actions/payments";
import { loadOpenInvoicesAction } from "@/actions/lookup";
import { buttonClass } from "./ui";

type Open = { id: string; invoiceNumber: string; dueDate: string; dueLabel: string; outstanding: string };

/** Parses "1,23,456.78" into paise without floats. Returns null if invalid. */
function toPaise(s: string): bigint | null {
  const c = s.replace(/[₹,\s]/g, "");
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(c)) return null;
  const [w, f = ""] = c.split(".");
  return BigInt(w) * 100n + BigInt((f + "00").slice(0, 2));
}
function fmt(p: bigint) {
  const neg = p < 0n;
  const a = neg ? -p : p;
  const w = (a / 100n).toString();
  const grouped = w.length > 3 ? w.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + w.slice(-3) : w;
  return `${neg ? "−" : ""}₹${grouped}.${(a % 100n).toString().padStart(2, "0")}`;
}

export function PaymentForm({ direction, parties, methods, today, initialCounterpartyId, initialInvoiceId, returnTo }: { direction: "received" | "made"; parties: { id: string; name: string }[]; methods: string[]; today: string; initialCounterpartyId?: string; initialInvoiceId?: string; returnTo?: string }) {
  const [partyId, setPartyId] = useState(initialCounterpartyId ?? "");
  const [open, setOpen] = useState<Open[]>([]);
  const [loading, start] = useTransition();
  const [amount, setAmount] = useState("");
  const [alloc, setAlloc] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!partyId) {
      setOpen([]);
      return;
    }
    start(async () => {
      const r = await loadOpenInvoicesAction(partyId, direction === "received" ? "receivable" : "payable");
      setOpen(r);
      setAlloc({});
    });
  }, [partyId, direction]);

  const amountP = toPaise(amount);
  const allocated = useMemo(() => Object.values(alloc).reduce((a, v) => a + (toPaise(v) ?? 0n), 0n), [alloc]);
  const remaining = amountP !== null ? amountP - allocated : null;

  // Pre-select the invoice the user came from.
  useEffect(() => {
    if (initialInvoiceId && open.some((o) => o.id === initialInvoiceId) && amountP !== null && Object.keys(alloc).length === 0) {
      const o = open.find((x) => x.id === initialInvoiceId)!;
      const out = toPaise(o.outstanding)!;
      setAlloc({ [o.id]: ((amountP < out ? amountP : out) / 100n).toString() + "." + ((amountP < out ? amountP : out) % 100n).toString().padStart(2, "0") });
    }
  }, [open, initialInvoiceId, amountP, alloc]);

  const autoAllocate = () => {
    if (amountP === null) return;
    let left = amountP;
    const next: Record<string, string> = {};
    for (const o of [...open].sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))) {
      if (left <= 0n) break;
      const out = toPaise(o.outstanding)!;
      const take = out < left ? out : left;
      next[o.id] = `${take / 100n}.${(take % 100n).toString().padStart(2, "0")}`;
      left -= take;
    }
    setAlloc(next);
  };

  return (
    <ActionForm action={recordPaymentAction} className="space-y-6">
      <input type="hidden" name="direction" value={direction} />
      {returnTo && <input type="hidden" name="returnTo" value={returnTo} />}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label={direction === "received" ? "Received from (customer)" : "Paid to (supplier)"} name="counterpartyId" required>
          <Select name="counterpartyId" value={partyId} onChange={(e) => setPartyId(e.target.value)} required>
            <option value="">Select…</option>
            {parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <Field label="Amount (₹)" name="amount" required>
          <Input name="amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </Field>
        <Field label="Payment date" name="paymentDate" required hint="Cannot be in the future.">
          <Input name="paymentDate" type="date" defaultValue={today} max={today} required />
        </Field>
        <Field label="Method" name="method" required>
          <Select name="method" defaultValue={methods[0]}>{methods.map((m) => <option key={m}>{m}</option>)}</Select>
        </Field>
        <Field label="Reference (UTR / cheque no. / UPI ref)" name="reference"><Input name="reference" /></Field>
        <Field label="Notes" name="notes"><Textarea name="notes" rows={1} /></Field>
      </section>

      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-[15px] font-semibold">Allocate to {direction === "received" ? "invoices" : "bills"}</h2>
            <p className="text-[12.5px] text-muted">Only explicitly allocated amounts reduce a balance. Anything left stays as an unallocated credit you can allocate later.</p>
          </div>
          <button type="button" onClick={autoAllocate} disabled={amountP === null || open.length === 0} className={buttonClass("secondary", "sm")}>Allocate oldest first</button>
        </div>
        {!partyId ? (
          <p className="rounded-md border border-dashed border-line-strong p-4 text-[13.5px] text-muted">Select the {direction === "received" ? "customer" : "supplier"} to see open {direction === "received" ? "invoices" : "bills"}.</p>
        ) : loading ? (
          <p className="p-4 text-[13.5px] text-muted">Loading open items…</p>
        ) : open.length === 0 ? (
          <p className="rounded-md border border-dashed border-line-strong p-4 text-[13.5px] text-muted">No open {direction === "received" ? "invoices" : "bills"}. The payment will be recorded as unallocated.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full min-w-[520px] text-[13.5px]">
              <thead><tr className="bg-[#fafaf7] text-left text-[12px] uppercase tracking-wide text-muted"><th className="px-3 py-2">Invoice</th><th className="px-3 py-2">Due</th><th className="px-3 py-2 text-right">Outstanding</th><th className="px-3 py-2 text-right">Allocate (₹)</th></tr></thead>
              <tbody>
                {open.map((o) => {
                  const v = alloc[o.id] ?? "";
                  const p = v ? toPaise(v) : 0n;
                  const over = p !== null && p > toPaise(o.outstanding)!;
                  return (
                    <tr key={o.id} className="border-t border-line">
                      <td className="px-3 py-2 font-medium">{o.invoiceNumber}</td>
                      <td className="px-3 py-2">{o.dueLabel}</td>
                      <td className="num px-3 py-2 text-right">₹{o.outstanding}</td>
                      <td className="px-3 py-1.5 text-right">
                        <label className="sr-only" htmlFor={`alloc_${o.id}`}>Allocate to {o.invoiceNumber}</label>
                        <input id={`alloc_${o.id}`} name={`alloc_${o.id}`} inputMode="decimal" value={v} onChange={(e) => setAlloc({ ...alloc, [o.id]: e.target.value })} className={`h-8 w-36 rounded-md border px-2 text-right ${over || p === null ? "border-bad" : "border-line-strong"}`} />
                        {(over || p === null) && <span className="block text-[12px] text-bad">{p === null ? "Invalid amount" : "More than outstanding"}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-2 flex flex-wrap gap-4 text-[13.5px]">
          <span>Allocated: <strong className="num">{fmt(allocated)}</strong></span>
          {remaining !== null && <span className={remaining < 0n ? "font-semibold text-bad" : "text-muted"}>{remaining < 0n ? `Over-allocated by ${fmt(-remaining)}` : `Unallocated: ${fmt(remaining)}`}</span>}
        </div>
      </section>

      <div className="flex gap-2">
        <SubmitButton>Record payment</SubmitButton>
        <Link href={returnTo ?? "/payments"} className={buttonClass("ghost")}>Cancel</Link>
      </div>
      <p className="text-[12.5px] text-muted">Recording a payment does not move money or verify it with a bank. Attach the confirmation on the next screen.</p>
    </ActionForm>
  );
}

export function AllocateExistingForm({ paymentId, open, unallocated }: { paymentId: string; open: Open[]; unallocated: string }) {
  return (
    <ActionForm action={allocatePaymentAction} className="space-y-3">
      <input type="hidden" name="paymentId" value={paymentId} />
      <p className="text-[13.5px]">Unallocated balance: <strong>₹{unallocated}</strong></p>
      <div className="overflow-x-auto rounded-md border border-line">
        <table className="w-full text-[13.5px]">
          <tbody>
            {open.map((o) => (
              <tr key={o.id} className="border-t border-line first:border-t-0">
                <td className="px-3 py-2 font-medium">{o.invoiceNumber}</td>
                <td className="px-3 py-2 text-muted">due {o.dueLabel}</td>
                <td className="num px-3 py-2 text-right">₹{o.outstanding}</td>
                <td className="px-3 py-1.5 text-right"><label className="sr-only" htmlFor={`x_${o.id}`}>Allocate</label><input id={`x_${o.id}`} name={`alloc_${o.id}`} inputMode="decimal" className="h-8 w-32 rounded-md border border-line-strong px-2 text-right" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <SubmitButton>Allocate</SubmitButton>
    </ActionForm>
  );
}
