"use client";

import { useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/cn";

/** On phones, filters collapse behind a toggle so the list is visible first. Always open on larger screens. */
export function MobileFilters({ children, active }: { children: React.ReactNode; active?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="no-print">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="mb-3 inline-flex h-9 items-center gap-1.5 rounded-md border border-line-strong bg-surface px-3 text-[13.5px] font-medium sm:hidden">
        <SlidersHorizontal className="h-4 w-4" /> Filters{active ? " (active)" : ""}
      </button>
      <div className={cn(open ? "block" : "hidden", "sm:block")}>{children}</div>
    </div>
  );
}
