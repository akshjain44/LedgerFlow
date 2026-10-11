"use client";

import { createContext, useContext, useEffect, useRef, useState, useTransition, type ComponentProps, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ActionResult } from "@/server/errors";
import { buttonClass } from "./ui";
import { cn } from "@/lib/cn";

type Action = (fd: FormData) => Promise<ActionResult<{ redirect?: string } | unknown>>;

const ErrorsCtx = createContext<{ errors: Record<string, string>; pending: boolean }>({ errors: {}, pending: false });
const DialogCtx = createContext<{ close: () => void } | null>(null);

/**
 * Submits a server action without the automatic React form reset, so the
 * user's input survives validation errors. Shows toasts and field errors.
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess,
  successMessage,
  onSuccess,
  confirm,
  id,
}: {
  action: Action;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  successMessage?: string;
  onSuccess?: (result: ActionResult<unknown>) => void;
  confirm?: string;
  id?: string;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const dialog = useContext(DialogCtx);

  return (
    <ErrorsCtx.Provider value={{ errors, pending }}>
      <form
        id={id}
        className={className}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (confirm && !window.confirm(confirm)) return;
          const form = e.currentTarget;
          const fd = new FormData(form);
          start(async () => {
            let result: ActionResult<unknown>;
            try {
              result = await action(fd);
            } catch {
              result = { ok: false, error: "Could not reach the server. Check your connection and try again." };
            }
            if (result.ok) {
              setErrors({});
              setFormError(null);
              toast.success(result.message ?? successMessage ?? "Saved");
              if (resetOnSuccess) form.reset();
              onSuccess?.(result);
              dialog?.close();
              const target = (result.data as { redirect?: string } | undefined)?.redirect;
              if (target) router.push(target);
              else router.refresh();
            } else {
              setErrors(result.fieldErrors ?? {});
              setFormError(result.error);
              toast.error(result.error);
              const first = result.fieldErrors && Object.keys(result.fieldErrors)[0];
              if (first) (form.elements.namedItem(first) as HTMLElement | null)?.focus?.();
            }
          });
        }}
      >
        {formError && (
          <div role="alert" className="mb-3 rounded-md border border-[#f3c7c2] bg-bad-soft px-3 py-2 text-[13px] text-bad">
            {formError}
          </div>
        )}
        {children}
      </form>
    </ErrorsCtx.Provider>
  );
}

export function useFormErrors() {
  return useContext(ErrorsCtx);
}

export function Field({ label, name, hint, required, children, className }: { label: ReactNode; name: string; hint?: ReactNode; required?: boolean; children: ReactNode; className?: string }) {
  const { errors } = useFormErrors();
  const err = errors[name];
  return (
    <div className={cn("min-w-0", className)}>
      <label htmlFor={name} className="mb-1 block text-[13px] font-medium text-ink-2">
        {label}
        {required && <span className="text-bad"> *</span>}
      </label>
      {children}
      {err ? (
        <p id={`${name}-error`} className="mt-1 text-[12.5px] text-bad">{err}</p>
      ) : hint ? (
        <p className="mt-1 text-[12.5px] text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

const inputBase =
  "block w-full rounded-md border bg-surface px-3 text-[14px] text-ink placeholder:text-[#9aa1ab] shadow-[inset_0_1px_1px_rgba(0,0,0,0.02)] focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:bg-subtle";

export function Input({ name, className, ...props }: ComponentProps<"input"> & { name: string }) {
  const { errors } = useFormErrors();
  return <input id={props.id ?? name} name={name} aria-invalid={!!errors[name]} aria-describedby={errors[name] ? `${name}-error` : undefined} className={cn(inputBase, "h-9", errors[name] ? "border-bad" : "border-line-strong", className)} {...props} />;
}

export function Textarea({ name, className, ...props }: ComponentProps<"textarea"> & { name: string }) {
  const { errors } = useFormErrors();
  return <textarea id={props.id ?? name} name={name} aria-invalid={!!errors[name]} className={cn(inputBase, "min-h-[76px] py-2", errors[name] ? "border-bad" : "border-line-strong", className)} {...props} />;
}

export function Select({ name, className, children, ...props }: ComponentProps<"select"> & { name: string }) {
  const { errors } = useFormErrors();
  return (
    <select id={props.id ?? name} name={name} aria-invalid={!!errors[name]} className={cn(inputBase, "h-9 pr-8", errors[name] ? "border-bad" : "border-line-strong", className)} {...props}>
      {children}
    </select>
  );
}

export function Checkbox({ name, label, defaultChecked, value = "on", hint }: { name: string; label: ReactNode; defaultChecked?: boolean; value?: string; hint?: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-[13.5px] text-ink-2">
      <input type="checkbox" name={name} value={value} defaultChecked={defaultChecked} className="mt-0.5 h-4 w-4 rounded border-line-strong accent-[var(--color-accent)]" />
      <span>
        {label}
        {hint && <span className="block text-[12.5px] text-muted">{hint}</span>}
      </span>
    </label>
  );
}

export function SubmitButton({ children, variant = "primary", className, size }: { children: ReactNode; variant?: "primary" | "secondary" | "danger" | "subtle"; className?: string; size?: "sm" | "md" }) {
  const { pending } = useFormErrors();
  return (
    <button type="submit" disabled={pending} className={cn(buttonClass(variant, size), className)} aria-busy={pending}>
      {pending && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />}
      {children}
    </button>
  );
}

/** Modal dialog built on the native <dialog> element (focus trap + Esc handled by the browser). */
export function Dialog({ trigger, title, description, children, triggerVariant = "secondary", triggerSize = "md", wide }: { trigger: ReactNode; title: string; description?: ReactNode; children: ReactNode; triggerVariant?: "primary" | "secondary" | "ghost" | "danger" | "subtle"; triggerSize?: "sm" | "md"; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (open) ref.current?.showModal();
    else ref.current?.close();
  }, [open]);
  return (
    <>
      <button type="button" className={buttonClass(triggerVariant, triggerSize)} onClick={() => setOpen(true)}>
        {trigger}
      </button>
      <dialog
        ref={ref}
        onClose={() => setOpen(false)}
        className={cn("m-auto w-[calc(100%-1.5rem)] rounded-xl border border-line bg-surface p-0 shadow-2xl", wide ? "max-w-3xl" : "max-w-lg")}
        aria-labelledby={title.replace(/\W/g, "") + "-t"}
      >
        {open && (
          <DialogCtx.Provider value={{ close: () => setOpen(false) }}>
            <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-3.5">
              <div>
                <h2 id={title.replace(/\W/g, "") + "-t"} className="text-[16px] font-semibold">{title}</h2>
                {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
              </div>
              <button type="button" onClick={() => setOpen(false)} className="rounded p-1 text-muted hover:bg-subtle" aria-label="Close">✕</button>
            </div>
            <div className="max-h-[75vh] overflow-y-auto px-5 py-4">{children}</div>
          </DialogCtx.Provider>
        )}
      </dialog>
    </>
  );
}

export function DialogCancel() {
  const d = useContext(DialogCtx);
  return (
    <button type="button" className={buttonClass("ghost")} onClick={() => d?.close()}>
      Cancel
    </button>
  );
}

/** Destructive or significant action requiring confirmation and (optionally) a reason. */
export function ConfirmAction({ action, label, title, description, reasonLabel, variant = "danger", size = "sm", hidden, confirmLabel }: { action: Action; label: ReactNode; title: string; description: ReactNode; reasonLabel?: string; variant?: "danger" | "secondary" | "ghost" | "primary"; size?: "sm" | "md"; hidden?: Record<string, string>; confirmLabel?: string }) {
  return (
    <Dialog trigger={label} title={title} triggerVariant={variant} triggerSize={size}>
      <ActionForm action={action}>
        {hidden && Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <div className="text-[13.5px] text-ink-2">{description}</div>
        {reasonLabel && (
          <div className="mt-3">
            <Field label={reasonLabel} name="reason" required>
              <Textarea name="reason" required minLength={3} />
            </Field>
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <DialogCancel />
          <SubmitButton variant={variant === "danger" ? "danger" : "primary"}>{confirmLabel ?? "Confirm"}</SubmitButton>
        </div>
      </ActionForm>
    </Dialog>
  );
}
