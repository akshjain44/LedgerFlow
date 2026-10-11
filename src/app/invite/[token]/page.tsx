import Link from "next/link";
import { getSession } from "@/server/auth/session";
import { peekInvitation } from "@/server/services/auth";
import { AcceptInviteForm } from "@/components/AuthForms";
import { ROLE_LABELS } from "@/domain/permissions";

export const metadata = { title: "Invitation" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const inv = await peekInvitation(token);
  const session = await getSession();
  return (
    <div className="flex min-h-screen items-center justify-center p-5">
      <div className="w-full max-w-md rounded-xl border border-line bg-surface p-6">
        {!inv ? (
          <>
            <h1 className="text-xl font-semibold">Invitation not valid</h1>
            <p className="mt-2 text-[13.5px] text-muted">It may have expired, been revoked or already been used. Ask the person who invited you for a new link.</p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold">Join {inv.businessName}</h1>
            <p className="mt-2 text-[13.5px] text-muted">You were invited as <strong>{ROLE_LABELS[inv.role]}</strong> ({inv.email}).</p>
            <div className="mt-5">
              {session ? (
                session.user.email === inv.email ? (
                  <AcceptInviteForm token={token} />
                ) : (
                  <p className="text-[13.5px] text-bad">You are signed in as {session.user.email}. Sign out and sign in as {inv.email} to accept.</p>
                )
              ) : (
                <div className="flex gap-2">
                  <Link className="flex-1 rounded-md bg-accent px-3 py-2 text-center text-sm font-medium text-white" href={`/signup?next=/invite/${token}&email=${encodeURIComponent(inv.email)}`}>Create account</Link>
                  <Link className="flex-1 rounded-md border border-line-strong px-3 py-2 text-center text-sm font-medium" href={`/login?next=/invite/${token}`}>Sign in</Link>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
