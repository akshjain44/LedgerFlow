"use client";

import Link from "next/link";
import { ActionForm, Field, Input, SubmitButton } from "./forms";
import { signInAction, signUpAction, forgotPasswordAction, resetPasswordAction, acceptInviteAction } from "@/actions/auth";

export function SignInForm({ next }: { next?: string }) {
  return (
    <ActionForm action={signInAction} className="space-y-4">
      <input type="hidden" name="next" value={next ?? ""} />
      <Field label="Email" name="email" required>
        <Input name="email" type="email" autoComplete="email" required />
      </Field>
      <Field label="Password" name="password" required>
        <Input name="password" type="password" autoComplete="current-password" required />
      </Field>
      <div className="flex items-center justify-between text-[13px]">
        <Link href="/forgot-password" className="text-accent hover:underline">Forgot password?</Link>
      </div>
      <SubmitButton className="w-full">Sign in</SubmitButton>
    </ActionForm>
  );
}

export function SignUpForm({ next, email }: { next?: string; email?: string }) {
  return (
    <ActionForm action={signUpAction} className="space-y-4">
      <input type="hidden" name="next" value={next ?? ""} />
      <Field label="Your name" name="name" required>
        <Input name="name" autoComplete="name" required />
      </Field>
      <Field label="Work email" name="email" required>
        <Input name="email" type="email" autoComplete="email" defaultValue={email} required />
      </Field>
      <Field label="Password" name="password" required hint="At least 10 characters, with a letter and a number.">
        <Input name="password" type="password" autoComplete="new-password" required minLength={10} />
      </Field>
      <SubmitButton className="w-full">Create account</SubmitButton>
    </ActionForm>
  );
}

export function ForgotForm() {
  return (
    <ActionForm action={forgotPasswordAction} className="space-y-4" resetOnSuccess>
      <Field label="Email" name="email" required>
        <Input name="email" type="email" autoComplete="email" required />
      </Field>
      <SubmitButton className="w-full">Send reset link</SubmitButton>
    </ActionForm>
  );
}

export function ResetForm({ token }: { token: string }) {
  return (
    <ActionForm action={resetPasswordAction} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <Field label="New password" name="password" required hint="At least 10 characters, with a letter and a number.">
        <Input name="password" type="password" autoComplete="new-password" required minLength={10} />
      </Field>
      <SubmitButton className="w-full">Set password</SubmitButton>
    </ActionForm>
  );
}

export function AcceptInviteForm({ token }: { token: string }) {
  return (
    <ActionForm action={acceptInviteAction}>
      <input type="hidden" name="token" value={token} />
      <SubmitButton className="w-full">Accept invitation</SubmitButton>
    </ActionForm>
  );
}
