"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { GameInfo } from "@/lib/games";
import { useHydrated, useMusicStore, useUserStore } from "@/lib/store";
import { GAME_COMPONENTS } from "@/components/games";
import { Keys, Pill } from "@/components/site/Chrome";

export default function PlayShell({ game }: { game: GameInfo }) {
  const router = useRouter();
  const user = useUserStore((s) => s.user);
  const hydrated = useHydrated();
  const startMusic = useMusicStore((s) => s.start);
  const [started, setStarted] = useState(false);
  const [showControls, setShowControls] = useState(false);

  useEffect(() => {
    if (hydrated && !user) router.replace("/#giris");
  }, [hydrated, user, router]);

  const GameComponent = GAME_COMPONENTS[game.slug];

  const begin = () => {
    startMusic();
    setStarted(true);
  };

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-[#c9d4de] select-none">
      {hydrated && user && <GameComponent started={started} />}

      {/* top-left: way back + where you are */}
      <div className="absolute left-4 top-4 z-20 flex items-center gap-2">
        <Link
          href="/games"
          className="inline-flex h-10 items-center gap-2 rounded-full border border-line bg-paper/95 pl-3 pr-4 text-[14px] font-medium text-ink backdrop-blur hover:border-ink"
        >
          <ArrowLeft className="size-4" /> Oyunlar
        </Link>
        <span className="inline-flex h-10 items-center rounded-full bg-ink px-4 text-[14px] font-semibold tracking-[-0.01em] text-paper">
          {game.title}
        </span>
      </div>

      {/* bottom-left: controls reference */}
      {started && (
        <div className="absolute bottom-4 left-4 z-20 max-w-[20rem]">
          {showControls && <ControlsCard game={game} className="mb-2 animate-fade-up" />}
          <button
            type="button"
            onClick={() => setShowControls((v) => !v)}
            aria-expanded={showControls}
            className="inline-flex h-10 items-center rounded-full border border-line bg-paper/95 px-4 text-[14px] font-medium text-ink backdrop-blur hover:border-ink"
          >
            {showControls ? "Kontrolleri gizle" : "Kontroller"}
          </button>
        </div>
      )}

      {/* start sheet */}
      {!started && (
        <div className="absolute inset-0 z-30 flex items-end bg-paper/55 backdrop-blur-[6px] sm:items-center">
          <div className="mx-auto w-full max-w-[1180px] px-4 pb-24 sm:px-10 sm:pb-0">
            <div className="max-w-[34rem] rounded-[28px] bg-paper p-7 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.35)] sm:p-10 animate-fade-up">
              <p className="text-[15px] text-muted-ink">{game.subtitle}</p>
              <h1 className="display mt-2 text-[clamp(3.2rem,7vw,5.5rem)]">{game.title}</h1>
              <p className="mt-5 text-[16px] leading-[1.55] text-ink">{game.description}</p>
              <p className="mt-3 text-[15px] leading-[1.55] text-muted-ink">{game.goal}</p>
              <ControlsList game={game} className="mt-6" />
              <div className="mt-8">
                <Pill onClick={begin}>Başlat</Pill>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function ControlsList({ game, className = "" }: { game: GameInfo; className?: string }) {
  return (
    <ul className={`grid gap-2 ${className}`}>
      {game.controls.map((c) => (
        <li key={c.label} className="flex items-center gap-3 text-[14px] text-ink">
          <Keys keys={c.keys} />
          <span className="text-muted-ink">{c.label}</span>
        </li>
      ))}
    </ul>
  );
}

function ControlsCard({ game, className = "" }: { game: GameInfo; className?: string }) {
  return (
    <div className={`rounded-[18px] border border-line bg-paper/95 p-4 backdrop-blur ${className}`}>
      <p className="mb-3 text-[13px] leading-[1.45] text-muted-ink">{game.goal}</p>
      <ControlsList game={game} />
    </div>
  );
}
