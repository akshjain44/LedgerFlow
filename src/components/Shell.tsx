import Link from "next/link";
import { Bell, Plus, Search } from "lucide-react";
import type { TenantContext } from "@/server/context";
import { ROLE_LABELS } from "@/domain/permissions";
import { signOutAction } from "@/actions/auth";
import { NavLinks, MobileNavToggle } from "./NavLinks";
import { BusinessSwitcher } from "./BusinessSwitcher";

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "LedgerFlow";

export function Shell({ ctx, unread, children }: { ctx: TenantContext; unread: number; children: React.ReactNode }) {
  const p = ctx.permissions;
  const nav = [
    { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
    p.has("receivables.view") && { href: "/receivables", label: "Receivables", icon: "receivables" },
    p.has("payables.view") && { href: "/payables", label: "Payables", icon: "payables" },
    p.has("receivables.view") && { href: "/customers", label: "Customers", icon: "customers" },
    p.has("payables.view") && { href: "/suppliers", label: "Suppliers", icon: "suppliers" },
    p.has("collections.work") && { href: "/follow-ups", label: "Follow-ups", icon: "followups" },
    (p.has("receivables.view") || p.has("payables.view")) && { href: "/payments", label: "Payments", icon: "payments" },
    p.has("reports.view") && { href: "/reports", label: "Reports", icon: "reports" },
    p.has("imports.run") && { href: "/imports", label: "Imports", icon: "imports" },
    { href: "/notifications", label: "Notifications", icon: "notifications", badge: unread },
    { href: "/settings", label: "Settings", icon: "settings" },
  ].filter(Boolean) as { href: string; label: string; icon: string; badge?: number }[];

  const quickAdd = [
    p.has("receivables.manage") && { href: "/receivables/new", label: "Receivable invoice" },
    p.has("payables.manage") && { href: "/payables/new", label: "Supplier bill" },
    p.has("payments.record") && p.has("receivables.view") && { href: "/payments/new?direction=received", label: "Payment received" },
    p.has("payments.record") && p.has("payables.view") && { href: "/payments/new?direction=made", label: "Payment made" },
    p.has("receivables.manage") && { href: "/customers/new", label: "Customer" },
    p.has("payables.manage") && { href: "/suppliers/new", label: "Supplier" },
  ].filter(Boolean) as { href: string; label: string }[];

  return (
    <div className="min-h-screen lg:pl-60">
      <aside id="sidebar" className="no-print fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-line bg-[#fbfbf8] data-[open=true]:flex lg:flex">
        <div className="flex h-14 items-center gap-2 border-b border-line px-4">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-ink text-[13px] font-bold text-white">{APP_NAME.slice(0, 1)}</span>
          <span className="text-[15px] font-semibold tracking-tight">{APP_NAME}</span>
        </div>
        <NavLinks items={nav} />
        <div className="border-t border-line p-3 text-[12px] text-muted">
          <p className="truncate font-medium text-ink-2">{ctx.businessName}</p>
          <p>{ROLE_LABELS[ctx.role]}</p>
          {ctx.isDemo && <p className="mt-1 rounded bg-warn-soft px-1.5 py-0.5 text-warn">Demo business — fictional data</p>}
        </div>
      </aside>

      <header className="no-print sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-canvas/95 px-3 backdrop-blur sm:px-5">
        <MobileNavToggle />
        <BusinessSwitcher current={ctx.businessId} memberships={ctx.memberships} />
        <form action="/search" className="relative ml-auto hidden max-w-sm flex-1 sm:block" role="search">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted" aria-hidden />
          <label htmlFor="global-search" className="sr-only">Search</label>
          <input id="global-search" name="q" placeholder="Search accounts, invoices, references…" className="h-9 w-full rounded-md border border-line-strong bg-surface pl-8 pr-3 text-[13.5px] focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20" />
        </form>
        <Link href="/search" className="ml-auto rounded-md p-2 text-ink-2 hover:bg-subtle sm:hidden" aria-label="Search"><Search className="h-5 w-5" /></Link>
        {quickAdd.length > 0 && (
          <details className="relative">
            <summary className="flex h-9 cursor-pointer list-none items-center gap-1 rounded-md bg-accent px-3 text-sm font-medium text-white hover:bg-accent-strong [&::-webkit-details-marker]:hidden">
              <Plus className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">New</span>
            </summary>
            <div className="absolute right-0 mt-1 w-52 rounded-lg border border-line bg-surface p-1 shadow-lg">
              {quickAdd.map((q) => (
                <Link key={q.href} href={q.href} className="block rounded-md px-3 py-2 text-[13.5px] hover:bg-subtle">{q.label}</Link>
              ))}
            </div>
          </details>
        )}
        <Link href="/notifications" className="relative rounded-md p-2 text-ink-2 hover:bg-subtle" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>
          <Bell className="h-5 w-5" />
          {unread > 0 && <span className="absolute right-1 top-1 min-w-4 rounded-full bg-bad px-1 text-center text-[10px] font-semibold leading-4 text-white">{unread > 99 ? "99+" : unread}</span>}
        </Link>
        <details className="relative">
          <summary className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-full bg-ink text-[13px] font-semibold text-white [&::-webkit-details-marker]:hidden" aria-label="Profile menu">
            {ctx.userName.slice(0, 1).toUpperCase()}
          </summary>
          <div className="absolute right-0 mt-1 w-60 rounded-lg border border-line bg-surface p-1 shadow-lg">
            <div className="px-3 py-2 text-[13px]">
              <p className="font-medium">{ctx.userName}</p>
              <p className="truncate text-muted">{ctx.userEmail}</p>
            </div>
            <Link href="/settings" className="block rounded-md px-3 py-2 text-[13.5px] hover:bg-subtle">Settings</Link>
            <form action={signOutAction}>
              <button className="w-full rounded-md px-3 py-2 text-left text-[13.5px] hover:bg-subtle">Sign out</button>
            </form>
          </div>
        </details>
      </header>
      <main className="mx-auto max-w-[1400px] px-4 py-5 sm:px-6 lg:py-6">{children}</main>
    </div>
  );
}
