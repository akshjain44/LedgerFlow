import { ResetForm } from "@/components/AuthForms";

export const metadata = { title: "Choose a new password" };

export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
      <p className="mb-6 mt-1 text-[13.5px] text-muted">All other sessions will be signed out.</p>
      <ResetForm token={token} />
    </>
  );
}
