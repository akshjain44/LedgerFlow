"use client";

import { Printer } from "lucide-react";
import { buttonClass } from "./ui";

export function PrintButton({ label = "Print / save as PDF" }: { label?: string }) {
  return (
    <button type="button" className={buttonClass("secondary")} onClick={() => window.print()}>
      <Printer className="h-4 w-4" />
      {label}
    </button>
  );
}
