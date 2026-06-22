"use client";

import { signIn } from "next-auth/react";
import Link from "next/link";
import { FormEvent, useState } from "react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const result = await signIn("credentials", {
      redirect: false,
      email,
      password
    });
    setLoading(false);
    if (result?.error) {
      setError("Credenciales invalidas");
      return;
    }
    window.location.href = "/panel";
  };

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="max-w-md w-full bg-slate-800/80 border border-slate-700 rounded-2xl p-8 shadow-xl space-y-6">
        <div className="text-center space-y-2">
          <p className="text-sm uppercase tracking-[0.2em] text-amber-400">Accede</p>
          <h1 className="text-2xl font-semibold">Inventario Mercado Libre</h1>
          <p className="text-slate-300 text-sm">Email y contrasena</p>
        </div>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <label className="block text-sm text-slate-200">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-slate-100 focus:border-amber-400 focus:outline-none"
              required
            />
          </div>
          <div className="space-y-2">
            <label className="block text-sm text-slate-200">Contrasena</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-slate-100 focus:border-amber-400 focus:outline-none"
              required
            />
          </div>
          {error && <p className="text-sm text-amber-400">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-primary hover:bg-teal-700 transition text-white font-semibold rounded-md py-2 disabled:opacity-60"
          >
            {loading ? "Entrando..." : "Entrar"}
          </button>
          <Link
            href="/public-inventory"
            className="block w-full rounded-md border border-emerald-500/60 bg-emerald-500/10 py-2 text-center text-sm font-semibold text-emerald-200 transition hover:border-emerald-400 hover:bg-emerald-400/20"
          >
            Ver inventario publico
          </Link>
        </form>
      </div>
    </main>
  );
}
