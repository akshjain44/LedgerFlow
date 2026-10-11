"use client";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-lg rounded-xl border border-line bg-surface p-6 text-center">
      <h1 className="text-lg font-semibold">This page could not be loaded</h1>
      <p className="mt-2 text-[13.5px] text-muted">{error.message?.includes("not found") ? error.message : "An unexpected error occurred. No changes were made."}</p>
      {error.digest && <p className="mt-1 text-[12px] text-muted">Reference: {error.digest}</p>}
      <button onClick={reset} className="mt-4 h-9 rounded-md bg-accent px-4 text-sm font-medium text-white">Try again</button>
    </div>
  );
}
