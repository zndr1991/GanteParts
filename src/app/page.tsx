import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="max-w-xl w-full bg-slate-800/80 border border-slate-700 rounded-2xl p-8 shadow-xl">
        <div className="flex flex-col gap-4 text-center">
          <p className="text-sm uppercase tracking-[0.2em] text-amber-400">Inventario MX</p>
          <h1 className="text-3xl font-semibold">Sincroniza stock y precio con Mercado Libre</h1>
          <p className="text-slate-300">
            Controla tu inventario, pausa publicaciones cuando el stock llegue a cero y mantente al dia con cambios en tiempo real.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center mt-2">
            <Link
              href="/login"
              className="px-4 py-2 rounded-lg bg-primary text-white font-medium hover:bg-teal-700 transition"
            >
              Ingresar
            </Link>
            <Link
              href="/public-inventory"
              className="px-4 py-2 rounded-lg border border-emerald-500/60 bg-emerald-500/10 text-emerald-200 font-medium hover:border-emerald-400 hover:bg-emerald-400/20 transition"
            >
              Inventario público
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
