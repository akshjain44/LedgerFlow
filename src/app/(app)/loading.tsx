export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading" className="animate-pulse space-y-4">
      <div className="h-7 w-56 rounded bg-line" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 rounded-lg bg-line/70" />)}
      </div>
      <div className="h-80 rounded-lg bg-line/60" />
    </div>
  );
}
