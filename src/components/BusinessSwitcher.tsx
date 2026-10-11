"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { switchBusinessAction } from "@/actions/auth";

export function BusinessSwitcher({ current, memberships }: { current: string; memberships: { businessId: string; businessName: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (memberships.length <= 1) return <span className="truncate text-[14px] font-semibold text-ink">{memberships[0]?.businessName}</span>;
  return (
    <label className="flex items-center gap-2">
      <span className="sr-only">Current business</span>
      <select
        value={current}
        disabled={pending}
        onChange={(e) => {
          const fd = new FormData();
          fd.set("businessId", e.target.value);
          start(async () => {
            const r = await switchBusinessAction(fd);
            if (r.ok) {
              toast.success(r.message ?? "Switched");
              router.push("/dashboard");
              router.refresh();
            } else toast.error(r.error);
          });
        }}
        className="h-9 max-w-[220px] truncate rounded-md border border-line-strong bg-surface px-2 text-[13.5px] font-semibold"
      >
        {memberships.map((m) => (
          <option key={m.businessId} value={m.businessId}>{m.businessName}</option>
        ))}
      </select>
    </label>
  );
}
