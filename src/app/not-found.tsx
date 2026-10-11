import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center p-6 text-center">
      <h1 className="text-xl font-semibold">Not found</h1>
      <p className="mt-1 text-[13.5px] text-muted">The page or record does not exist, or you do not have access to it.</p>
      <Link href="/dashboard" className="mt-4 text-accent hover:underline">Back to dashboard</Link>
    </div>
  );
}
