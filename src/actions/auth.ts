"use server";

import { redirect } from "next/navigation";
import { signIn, signOut, signUp, requestPasswordReset, resetPassword } from "@/server/services/auth";
import { acceptInvitation, createBusiness, switchBusiness } from "@/server/services/business";
import { getSession } from "@/server/auth/session";
import { tenantOrThrow } from "@/server/context";
import { toActionError, type ActionResult } from "@/server/errors";
import { fields, list, str } from "./_run";

const safeNext = (n: string) => (n.startsWith("/") && !n.startsWith("//") ? n : "/dashboard");

export async function signInAction(fd: FormData): Promise<ActionResult<{ redirect: string }>> {
  try {
    await signIn(str(fd, "email"), str(fd, "password"));
    return { ok: true, message: "Signed in", data: { redirect: safeNext(str(fd, "next")) } };
  } catch (e) {
    return toActionError(e);
  }
}

export async function signUpAction(fd: FormData): Promise<ActionResult<{ redirect: string }>> {
  try {
    await signUp({ name: str(fd, "name"), email: str(fd, "email"), password: str(fd, "password") });
    const next = str(fd, "next");
    return { ok: true, message: "Account created", data: { redirect: next.startsWith("/invite/") ? next : "/onboarding" } };
  } catch (e) {
    return toActionError(e);
  }
}

export async function signOutAction() {
  await signOut();
  redirect("/login");
}

export async function forgotPasswordAction(fd: FormData): Promise<ActionResult> {
  try {
    const r = await requestPasswordReset(str(fd, "email"));
    return {
      ok: true,
      message:
        r.deliveredBy === "dev-console"
          ? "Email is not configured. In development, the reset link was printed to the server console."
          : "If an account exists for that email, a reset link has been sent.",
    };
  } catch (e) {
    return toActionError(e);
  }
}

export async function resetPasswordAction(fd: FormData): Promise<ActionResult<{ redirect: string }>> {
  try {
    await resetPassword(str(fd, "token"), str(fd, "password"));
    return { ok: true, message: "Password updated", data: { redirect: "/dashboard" } };
  } catch (e) {
    return toActionError(e);
  }
}

export async function createBusinessAction(fd: FormData): Promise<ActionResult<{ redirect: string }>> {
  try {
    const session = await getSession();
    if (!session) return { ok: false, error: "Please sign in again." };
    const f = fields(fd);
    await createBusiness(session.userId, session.id, { ...f, workingDays: list(fd, "workingDays") } as never);
    return { ok: true, message: "Business created", data: { redirect: "/dashboard" } };
  } catch (e) {
    return toActionError(e);
  }
}

export async function acceptInviteAction(fd: FormData): Promise<ActionResult<{ redirect: string }>> {
  try {
    const session = await getSession();
    if (!session) return { ok: false, error: "Please sign in first." };
    await acceptInvitation(session.userId, session.user.email, session.id, str(fd, "token"));
    return { ok: true, message: "Welcome aboard", data: { redirect: "/dashboard" } };
  } catch (e) {
    return toActionError(e);
  }
}

export async function switchBusinessAction(fd: FormData): Promise<ActionResult<{ redirect: string }>> {
  try {
    const ctx = await tenantOrThrow();
    await switchBusiness(ctx, str(fd, "businessId"));
    return { ok: true, message: "Switched business", data: { redirect: "/dashboard" } };
  } catch (e) {
    return toActionError(e);
  }
}
