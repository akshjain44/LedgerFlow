import { redirect } from "next/navigation";
import { requireUser, getTenantContext } from "@/server/context";
import { OnboardingForm } from "@/components/OnboardingForm";
import { signOutAction } from "@/actions/auth";

export const metadata = { title: "Set up your business" };

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ another?: string }> }) {
  const session = await requireUser();
  const { another } = await searchParams;
  if (!another && (await getTenantContext())) redirect("/dashboard");
  return (
    <div className="mx-auto max-w-2xl px-5 py-10">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Set up your business</h1>
          <p className="mt-1 text-[13.5px] text-muted">Signed in as {session.user.email}. You can invite your team after this step.</p>
        </div>
        <form action={signOutAction}><button className="text-[13px] text-muted hover:underline">Sign out</button></form>
      </div>
      <div className="rounded-xl border border-line bg-surface p-5 sm:p-6">
        <OnboardingForm />
      </div>
    </div>
  );
}
