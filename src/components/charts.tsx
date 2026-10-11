"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const inr = (v: number) => "₹" + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(v);
const compact = (v: number) => (v >= 1e7 ? `₹${(v / 1e7).toFixed(1)}Cr` : v >= 1e5 ? `₹${(v / 1e5).toFixed(1)}L` : v >= 1e3 ? `₹${(v / 1e3).toFixed(0)}k` : `₹${v}`);

/** Ageing buckets for receivables vs payables. Values are rupees for display only. */
export function AgeingChart({ data, showPayables }: { data: { bucket: string; receivables: number; payables: number }[]; showPayables: boolean }) {
  return (
    <div className="h-64 w-full" role="img" aria-label="Outstanding balances by ageing bucket">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
          <CartesianGrid vertical={false} stroke="#ebe9e2" />
          <XAxis dataKey="bucket" tick={{ fontSize: 12, fill: "#6b7280" }} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={compact} tick={{ fontSize: 12, fill: "#6b7280" }} axisLine={false} tickLine={false} width={64} />
          <Tooltip formatter={(v) => inr(Number(v))} cursor={{ fill: "#f1f0eb" }} contentStyle={{ borderRadius: 8, border: "1px solid #e3e1d9", fontSize: 13 }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="receivables" name="Receivables" fill="#2453a8" radius={[3, 3, 0, 0]} maxBarSize={36} />
          {showPayables && <Bar dataKey="payables" name="Payables" fill="#a3630b" radius={[3, 3, 0, 0]} maxBarSize={36} />}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CashFlowChart({ data }: { data: { label: string; incoming: number; outgoing: number }[] }) {
  return (
    <div className="h-64 w-full" role="img" aria-label="Expected incoming and outgoing amounts by horizon">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="#ebe9e2" />
          <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#6b7280" }} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={compact} tick={{ fontSize: 12, fill: "#6b7280" }} axisLine={false} tickLine={false} width={64} />
          <Tooltip formatter={(v) => inr(Number(v))} cursor={{ fill: "#f1f0eb" }} contentStyle={{ borderRadius: 8, border: "1px solid #e3e1d9", fontSize: 13 }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="incoming" name="Expected incoming" fill="#2f7a4f" radius={[3, 3, 0, 0]} maxBarSize={44} />
          <Bar dataKey="outgoing" name="Expected outgoing" fill="#b42318" radius={[3, 3, 0, 0]} maxBarSize={44} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
