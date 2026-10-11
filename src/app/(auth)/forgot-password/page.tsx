import Link from "next/link";
import { ForgotForm } from "@/components/AuthForms";

export const metadata = { title: "Reset password" };

export default function ForgotPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
      <p className="mb-6 mt-1 text-[13.5px] text-muted">We will email a link that is valid for one hour.</p>
      <ForgotForm />
      <p className="mt-6 text-[13.5px]"><Link href="/login" className="text-accent hover:underline">Back to sign in</Link></p>
    </>
  );
}
