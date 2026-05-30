export default function PublicInventoryLoading() {
  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100">
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <div className="h-10 w-64 animate-pulse rounded-xl bg-slate-800" />
        <div className="h-12 w-full animate-pulse rounded-2xl border border-slate-800 bg-slate-900/70" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="h-44 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/70" />
          <div className="h-44 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/70" />
          <div className="h-44 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/70" />
          <div className="h-44 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/70" />
          <div className="h-44 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/70" />
          <div className="h-44 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/70" />
        </div>
      </div>
    </main>
  );
}
