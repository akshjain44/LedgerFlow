const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "LedgerFlow";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_1.1fr]">
      <div className="flex flex-col justify-center px-5 py-10 sm:px-10">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-ink text-sm font-bold text-white">{APP_NAME.slice(0, 1)}</span>
            <span className="text-lg font-semibold tracking-tight">{APP_NAME}</span>
          </div>
          {children}
        </div>
      </div>
      <div className="hidden flex-col justify-center border-l border-line bg-[#eeede7] px-12 lg:flex">
        <div className="max-w-md">
          <p className="text-[13px] font-semibold uppercase tracking-wider text-accent">Receivables · Payables · Collections</p>
          <h2 className="mt-3 text-3xl font-semibold leading-tight tracking-tight text-ink">Know who owes you, who you owe, and who to call next.</h2>
          <ul className="mt-6 space-y-3 text-[14px] text-ink-2">
            <li>• Every overdue invoice surfaces automatically — none fall off a manual list.</li>
            <li>• Calls, promises and disputes are recorded, dated and followed through.</li>
            <li>• Repeated broken promises escalate to the owner with the facts attached.</li>
            <li>• Supplier bills and planned payments in the same place.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
