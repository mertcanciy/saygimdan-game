"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useHydrated, useUserStore } from "@/lib/store";
import { GAMES } from "@/lib/games";
import GameCover from "@/components/GameCover";

export default function GamesPage() {
  const router = useRouter();
  const { user, clearUser } = useUserStore();
  const hydrated = useHydrated();

  useEffect(() => {
    if (hydrated && !user) router.replace("/");
  }, [hydrated, user, router]);

  if (!hydrated || !user) {
    return <main className="min-h-dvh bg-[#05060f]" />;
  }

  return (
    <main className="min-h-dvh bg-[#05060f] text-white relative">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(88,28,135,0.25),transparent_60%)] pointer-events-none" />
      <header className="relative z-10 flex items-center justify-between px-6 py-5 max-w-5xl mx-auto">
        <h1 className="text-xl font-bold">
          Hoş geldin,{" "}
          <span className="bg-gradient-to-r from-fuchsia-400 to-sky-400 bg-clip-text text-transparent">
            {user.name}
          </span>
        </h1>
        <button
          onClick={() => {
            clearUser();
            router.push("/");
          }}
          className="text-sm text-white/60 hover:text-white border border-white/15 rounded-lg px-4 py-2 hover:border-white/40 transition cursor-pointer"
        >
          Çıkış
        </button>
      </header>

      <section className="relative z-10 max-w-5xl mx-auto px-6 pb-16 grid grid-cols-1 md:grid-cols-2 gap-6">
        {GAMES.map((game) => (
          <Link
            key={game.slug}
            href={`/play/${game.slug}`}
            className="group rounded-2xl overflow-hidden border border-white/10 bg-white/[0.03] backdrop-blur transition duration-300 hover:scale-[1.02]"
            style={{ ["--accent" as string]: game.accent }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.boxShadow = `0 0 40px ${game.accent}55`)
            }
            onMouseLeave={(e) => (e.currentTarget.style.boxShadow = "none")}
          >
            <GameCover slug={game.slug} />
            <div className="p-5">
              <h2 className="text-2xl font-bold" style={{ color: game.accent }}>
                {game.title}
              </h2>
              <p className="text-sm text-white/70 mt-1">{game.subtitle}</p>
              <p className="text-xs text-white/40 mt-3 leading-relaxed">
                {game.description}
              </p>
            </div>
          </Link>
        ))}
      </section>
    </main>
  );
}
