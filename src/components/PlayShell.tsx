"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { GameInfo } from "@/lib/games";
import { useHydrated, useUserStore } from "@/lib/store";
import MusicPlayer from "@/components/MusicPlayer";
import { GAME_COMPONENTS } from "@/components/games";

export default function PlayShell({ game }: { game: GameInfo }) {
  const router = useRouter();
  const user = useUserStore((s) => s.user);
  const hydrated = useHydrated();
  const [started, setStarted] = useState(false);
  const [showControls, setShowControls] = useState(true);

  useEffect(() => {
    if (hydrated && !user) router.replace("/");
  }, [hydrated, user, router]);

  const GameComponent = GAME_COMPONENTS[game.slug];

  return (
    <main className="relative h-dvh w-full bg-black overflow-hidden">
      {hydrated && user && <GameComponent started={started} />}

      {/* Top-left overlay */}
      <div className="absolute top-4 left-4 z-20 flex items-center gap-3">
        <button
          onClick={() => router.push("/games")}
          className="rounded-lg border border-white/15 bg-black/50 backdrop-blur px-4 py-2 text-sm text-white/80 hover:text-white hover:border-white/40 transition cursor-pointer"
        >
          ← Oyunlar
        </button>
        <span
          className="text-lg font-bold drop-shadow"
          style={{ color: game.accent }}
        >
          {game.title}
        </span>
      </div>

      {/* Bottom-left controls hint */}
      <div className="absolute bottom-4 left-4 z-20 max-w-xs">
        <button
          onClick={() => setShowControls((v) => !v)}
          className="rounded-lg border border-white/15 bg-black/50 backdrop-blur px-3 py-1.5 text-xs text-white/70 hover:text-white transition cursor-pointer"
        >
          Kontroller {showControls ? "▾" : "▸"}
        </button>
        {showControls && (
          <ul className="mt-2 rounded-lg border border-white/10 bg-black/60 backdrop-blur p-3 text-xs text-white/60 space-y-1">
            {game.controls.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        )}
      </div>

      {/* Bottom-right music player */}
      <div className="absolute bottom-4 right-4 z-20">
        <MusicPlayer started={started} />
      </div>

      {/* Start overlay */}
      {!started && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="text-center">
            <h2
              className="text-5xl font-extrabold mb-2"
              style={{ color: game.accent }}
            >
              {game.title}
            </h2>
            <p className="text-white/60 mb-8">{game.subtitle}</p>
            <button
              onClick={() => setStarted(true)}
              className="rounded-xl px-10 py-4 text-xl font-bold text-white transition hover:brightness-110 cursor-pointer"
              style={{
                backgroundColor: game.accent,
                boxShadow: `0 0 40px ${game.accent}88`,
              }}
            >
              ▶ Saygımdan&apos;ı Başlat
            </button>
            <p className="mt-4 text-xs text-white/40">
              Bengü çalmaya başlar, sen de şehre dalarsın.
            </p>
          </div>
        </div>
      )}
    </main>
  );
}
