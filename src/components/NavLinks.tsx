"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { Menu, LayoutDashboard, ArrowDownLeft, ArrowUpRight, Users, Truck, PhoneCall, Wallet, BarChart3, Upload, Bell, Settings } from "lucide-react";
import { cn } from "@/lib/cn";

const ICONS = { dashboard: LayoutDashboard, receivables: ArrowDownLeft, payables: ArrowUpRight, customers: Users, suppliers: Truck, followups: PhoneCall, payments: Wallet, reports: BarChart3, imports: Upload, notifications: Bell, settings: Settings } as const;

export function NavLinks({ items }: { items: { href: string; label: string; icon: string; badge?: number }[] }) {
  const path = usePathname();
  useEffect(() => {
    document.getElementById("sidebar")?.setAttribute("data-open", "false");
  }, [path]);
  return (
    <nav className="flex-1 space-y-0.5 overflow-y-auto p-2" aria-label="Main">
      {items.map((i) => {
        const Icon = ICONS[i.icon as keyof typeof ICONS];
        const active = path === i.href || path.startsWith(i.href + "/");
        return (
          <Link key={i.href} href={i.href} aria-current={active ? "page" : undefined} className={cn("flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13.5px] font-medium", active ? "bg-accent-soft text-accent-strong" : "text-ink-2 hover:bg-subtle")}>
            {Icon && <Icon className="h-4 w-4" aria-hidden />}
            <span className="flex-1">{i.label}</span>
            {!!i.badge && <span className="rounded-full bg-bad px-1.5 text-[11px] font-semibold text-white">{i.badge > 99 ? "99+" : i.badge}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

export function MobileNavToggle() {
  return (
    <button
      type="button"
      className="rounded-md p-2 text-ink-2 hover:bg-subtle lg:hidden"
      aria-label="Open navigation"
      aria-controls="sidebar"
      onClick={() => {
        const el = document.getElementById("sidebar");
        if (el) el.setAttribute("data-open", el.getAttribute("data-open") === "true" ? "false" : "true");
      }}
    >
      <Menu className="h-5 w-5" />
    </button>
  );
}
