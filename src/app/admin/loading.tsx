export default function AdminLoading() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-6" aria-busy="true" aria-live="polite">
      <div className="h-4 w-32 animate-pulse rounded bg-zinc-200" />
      <div className="mt-3 h-7 w-64 animate-pulse rounded bg-zinc-200" />
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {["a", "b", "c", "d"].map((key) => (
          <div className="h-20 animate-pulse rounded-xl border border-zinc-200 bg-white" key={key} />
        ))}
      </div>
      <div className="mt-6 h-72 animate-pulse rounded-xl border border-zinc-200 bg-white" />
    </div>
  );
}
