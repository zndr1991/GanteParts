export default function PanelLoading() {
  return (
    <main className="min-h-screen bg-slate-950 px-4 py-10 text-slate-100">
      <div className="mx-auto flex max-w-4xl flex-col gap-8">
        <section className="rounded-3xl border border-slate-800 bg-slate-900/60 p-8">
          <div className="h-4 w-40 animate-pulse rounded bg-slate-700" />
          <div className="mt-4 h-9 w-64 animate-pulse rounded bg-slate-800" />
          <div className="mt-3 h-4 w-52 animate-pulse rounded bg-slate-800" />
          <div className="mt-6 h-4 w-full animate-pulse rounded bg-slate-800" />
          <div className="mt-2 h-4 w-11/12 animate-pulse rounded bg-slate-800" />
        </section>
        <section className="grid gap-4 sm:grid-cols-2">
          <div className="h-36 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/60" />
          <div className="h-36 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/60" />
          <div className="h-36 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/60" />
          <div className="h-36 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/60" />
        </section>
      </div>
    </main>
  );
}
