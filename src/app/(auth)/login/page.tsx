import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/server/auth/session";
import { SignInForm } from "@/components/AuthForms";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getSession()) redirect("/dashboard");
  const { next } = await searchParams;
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      <p className="mb-6 mt-1 text-[13.5px] text-muted">Welcome back. Pick up where your team left off.</p>
      <SignInForm next={next} />
      <p className="mt-6 text-[13.5px] text-muted">
        New here? <Link href={`/signup${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-medium text-accent hover:underline">Create an account</Link>
      </p>
    </>
  );
}
