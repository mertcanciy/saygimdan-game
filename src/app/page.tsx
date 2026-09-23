"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useHydrated, useUserStore } from "@/lib/store";

export default function LoginPage() {
  const router = useRouter();
  const { user, setUser } = useUserStore();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const hydrated = useHydrated();

  useEffect(() => {
    if (hydrated && user) router.replace("/games");
  }, [hydrated, user, router]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("İsminizi girin");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Geçerli bir mail adresi girin");
      return;
    }
    setUser({ name: name.trim(), email: email.trim() });
    router.push("/games");
  };

  return (
    <main className="min-h-dvh flex items-center justify-center bg-[#05060f] relative overflow-hidden px-4">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(88,28,135,0.35),transparent_60%),radial-gradient(ellipse_at_bottom,rgba(30,58,138,0.3),transparent_60%)]" />
      <div className="absolute bottom-0 inset-x-0 h-40 bg-gradient-to-t from-[#0b0d1f] to-transparent" />
      <form
        onSubmit={submit}
        className="relative z-10 w-full max-w-sm rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-8 shadow-[0_0_60px_rgba(168,85,247,0.15)]"
      >
        <h1 className="text-4xl font-extrabold tracking-tight text-center bg-gradient-to-r from-fuchsia-400 via-pink-400 to-sky-400 bg-clip-text text-transparent drop-shadow-[0_0_20px_rgba(217,70,239,0.4)]">
          Saygımdan
        </h1>
        <p className="mt-2 text-center text-sm text-white/50">
          Bengü çalarken şehirde dolan.
        </p>

        <label className="block mt-8 text-xs uppercase tracking-widest text-white/40">
          İsminizi girin
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="İsminiz"
          className="mt-2 w-full rounded-lg border border-white/10 bg-black/40 px-4 py-3 text-white placeholder-white/30 outline-none focus:border-fuchsia-400/60 focus:ring-2 focus:ring-fuchsia-400/20 transition"
        />

        <label className="block mt-5 text-xs uppercase tracking-widest text-white/40">
          Mailinizi girin
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="ornek@mail.com"
          className="mt-2 w-full rounded-lg border border-white/10 bg-black/40 px-4 py-3 text-white placeholder-white/30 outline-none focus:border-fuchsia-400/60 focus:ring-2 focus:ring-fuchsia-400/20 transition"
        />

        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

        <button
          type="submit"
          className="mt-7 w-full rounded-lg bg-gradient-to-r from-fuchsia-500 to-sky-500 py-3 font-semibold text-white shadow-[0_0_25px_rgba(217,70,239,0.4)] hover:brightness-110 hover:shadow-[0_0_35px_rgba(217,70,239,0.6)] transition cursor-pointer"
        >
          Devam
        </button>
      </form>
    </main>
  );
}
