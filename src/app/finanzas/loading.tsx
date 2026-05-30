export default function FinanzasLoading() {
  return (
    <main className="min-h-screen bg-slate-900 px-4 py-8 text-slate-100">
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <div className="h-10 w-56 animate-pulse rounded-xl bg-slate-800" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="h-24 animate-pulse rounded-2xl border border-slate-800 bg-slate-800/70" />
          <div className="h-24 animate-pulse rounded-2xl border border-slate-800 bg-slate-800/70" />
          <div className="h-24 animate-pulse rounded-2xl border border-slate-800 bg-slate-800/70" />
          <div className="h-24 animate-pulse rounded-2xl border border-slate-800 bg-slate-800/70" />
        </div>
        <div className="h-[46vh] animate-pulse rounded-3xl border border-slate-800 bg-slate-800/70" />
      </div>
    </main>
  );
}
