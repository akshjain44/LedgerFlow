import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/server/auth/session";
import { SignUpForm } from "@/components/AuthForms";

export const metadata = { title: "Create account" };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string; email?: string }> }) {
  if (await getSession()) redirect("/dashboard");
  const { next, email } = await searchParams;
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
      <p className="mb-6 mt-1 text-[13.5px] text-muted">You will set up your business next. GSTIN is optional.</p>
      <SignUpForm next={next} email={email} />
      <p className="mt-6 text-[13.5px] text-muted">
        Already registered? <Link href={`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-medium text-accent hover:underline">Sign in</Link>
      </p>
    </>
  );
}
