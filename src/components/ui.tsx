import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Button({ variant = "secondary", size = "md", className, ...props }: ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  return <button className={cn(buttonClass(variant, size), className)} {...props} />;
}

export function LinkButton({ variant = "secondary", size = "md", className, ...props }: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={cn(buttonClass(variant, size), className)} {...props} />;
}

type Variant = "primary" | "secondary" | "ghost" | "danger" | "subtle";
type Size = "sm" | "md";

export function buttonClass(variant: Variant = "secondary", size: Size = "md") {
  return cn(
    "inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors disabled:opacity-50 disabled:pointer-events-none",
    size === "sm" ? "h-8 px-2.5 text-[13px]" : "h-9 px-3.5 text-sm",
    variant === "primary" && "bg-accent text-white hover:bg-accent-strong shadow-sm",
    variant === "secondary" && "bg-surface text-ink border border-line-strong hover:bg-subtle",
    variant === "ghost" && "text-ink-2 hover:bg-subtle",
    variant === "subtle" && "bg-accent-soft text-accent-strong hover:bg-[#dbe5f6]",
    variant === "danger" && "bg-bad text-white hover:bg-[#931c13]",
  );
}

export function Card({ className, children, title, actions, description, padded = true }: { className?: string; children: ReactNode; title?: ReactNode; actions?: ReactNode; description?: ReactNode; padded?: boolean }) {
  return (
    <section className={cn("rounded-[var(--radius-card)] border border-line bg-surface shadow-[0_1px_2px_rgba(22,32,46,0.04)]", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-3">
          <div>
            {title && <h2 className="text-[15px] font-semibold text-ink">{title}</h2>}
            {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={padded ? "p-4" : ""}>{children}</div>
    </section>
  );
}

export type Tone = "neutral" | "ok" | "warn" | "bad" | "accent" | "info";
const TONES: Record<Tone, string> = {
  neutral: "bg-subtle text-ink-2 border-line",
  ok: "bg-ok-soft text-ok border-[#c9e3d3]",
  warn: "bg-warn-soft text-warn border-[#f0dcb4]",
  bad: "bg-bad-soft text-bad border-[#f3c7c2]",
  accent: "bg-accent-soft text-accent-strong border-[#cddaf1]",
  info: "bg-info-soft text-ink-2 border-line",
};

export function Badge({ tone = "neutral", children, title, className }: { tone?: Tone; children: ReactNode; title?: string; className?: string }) {
  return (
    <span title={title} className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[12px] font-medium whitespace-nowrap", TONES[tone], className)}>
      {children}
    </span>
  );
}

export function PageHeader({ title, description, actions, breadcrumbs }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; breadcrumbs?: { href?: string; label: string }[] }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav aria-label="Breadcrumb" className="mb-1 flex flex-wrap items-center gap-1 text-[13px] text-muted">
            {breadcrumbs.map((b, i) => (
              <span key={i} className="flex items-center gap-1">
                {b.href ? <Link href={b.href} className="hover:text-ink hover:underline">{b.label}</Link> : <span>{b.label}</span>}
                {i < breadcrumbs.length - 1 && <span aria-hidden>/</span>}
              </span>
            ))}
          </nav>
        )}
        <h1 className="truncate text-[22px] font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-[13.5px] text-muted">{description}</p>}
      </div>
      {actions && <div className="no-print flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-line-strong bg-surface px-6 py-10 text-center">
      <p className="text-[15px] font-semibold text-ink">{title}</p>
      {children && <div className="mt-1 max-w-md text-[13.5px] text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Stat({ label, value, sub, tone = "neutral", href, help }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone; href?: string; help?: string }) {
  const body = (
    <div className={cn("h-full rounded-[var(--radius-card)] border bg-surface p-3.5", tone === "bad" ? "border-[#f0c9c4]" : tone === "warn" ? "border-[#efdcb7]" : "border-line", href && "transition-colors hover:border-line-strong hover:bg-[#fcfcfa]")}>
      <div className="flex items-center gap-1 text-[12.5px] font-medium text-muted">
        {label}
        {help && <Help text={help} />}
      </div>
      <div className={cn("num mt-1 text-[20px] font-semibold tracking-tight", tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : tone === "ok" ? "text-ok" : "text-ink")}>{value}</div>
      {sub && <div className="mt-0.5 text-[12.5px] text-muted">{sub}</div>}
    </div>
  );
  return href ? <Link href={href} className="block h-full">{body}</Link> : body;
}

/** Accessible inline definition: hover/focus shows the explanation. */
export function Help({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex">
      <span tabIndex={0} aria-label={text} className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-line-strong text-[10px] font-semibold text-muted">?</span>
      <span role="tooltip" className="pointer-events-none absolute left-1/2 top-5 z-30 hidden w-64 -translate-x-1/2 rounded-md bg-ink px-2.5 py-2 text-[12px] font-normal leading-snug text-white shadow-lg group-hover:block group-focus-within:block">
        {text}
      </span>
    </span>
  );
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full min-w-[640px] border-collapse text-[13.5px]">{children}</table>
    </div>
  );
}

export function Th({ children, className, align }: { children?: ReactNode; className?: string; align?: "right" | "left" | "center" }) {
  return <th scope="col" className={cn("border-b border-line bg-[#fafaf7] px-3 py-2 text-left text-[12px] font-semibold uppercase tracking-wide text-muted whitespace-nowrap", align === "right" && "text-right", align === "center" && "text-center", className)}>{children}</th>;
}

export function Td({ children, className, align }: { children?: ReactNode; className?: string; align?: "right" | "left" | "center" }) {
  return <td className={cn("border-b border-line px-3 py-2.5 align-top", align === "right" && "text-right", align === "center" && "text-center", className)}>{children}</td>;
}

export function Dl({ items, cols = 2 }: { items: [ReactNode, ReactNode][]; cols?: 2 | 3 | 4 }) {
  return (
    <dl className={cn("grid gap-x-6 gap-y-3", cols === 2 && "sm:grid-cols-2", cols === 3 && "sm:grid-cols-3", cols === 4 && "sm:grid-cols-2 lg:grid-cols-4")}>
      {items.map(([k, v], i) => (
        <div key={i} className="min-w-0">
          <dt className="text-[12px] font-medium text-muted">{k}</dt>
          <dd className="mt-0.5 break-words text-[13.5px] text-ink">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Notice({ tone = "info", title, children }: { tone?: Tone; title?: string; children: ReactNode }) {
  return (
    <div role="note" className={cn("rounded-lg border px-3.5 py-2.5 text-[13px]", TONES[tone])}>
      {title && <p className="font-semibold">{title}</p>}
      <div className={title ? "mt-0.5" : ""}>{children}</div>
    </div>
  );
}
