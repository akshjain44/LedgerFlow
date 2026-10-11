"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

export function SettingsNav({ items }: { items: { href: string; label: string }[] }) {
  const path = usePathname();
  return (
    <nav aria-label="Settings" className="flex gap-1 overflow-x-auto lg:flex-col">
      {items.map((i) => (
        <Link key={i.href} href={i.href} aria-current={path === i.href ? "page" : undefined} className={cn("whitespace-nowrap rounded-md px-3 py-2 text-[13.5px] font-medium", path === i.href ? "bg-accent-soft text-accent-strong" : "text-ink-2 hover:bg-subtle")}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
