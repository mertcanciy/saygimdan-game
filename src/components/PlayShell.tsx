"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Maximize2, Minimize2 } from "lucide-react";
import { GameInfo } from "@/lib/games";
import { useHydrated, useMusicStore, useUserStore } from "@/lib/store";
import { GAME_COMPONENTS } from "@/components/games";
import TouchControls, { TOUCH_HELP } from "@/components/games/shared/TouchControls";
import { useIsPortrait, useIsTouch } from "@/components/games/shared/useDevice";
import { Keys, Pill } from "@/components/site/Chrome";

function canFullscreen() {
  return typeof document !== "undefined" && !!document.documentElement.requestFullscreen;
}

async function enterLandscapeFullscreen() {
  try {
    if (canFullscreen() && !document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: "hide" });
    const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    await o.lock?.("landscape");
  } catch {
    // iOS Safari and some browsers refuse; the rotate hint covers that case
  }
}

export default function PlayShell({ game }: { game: GameInfo }) {
  const router = useRouter();
  const user = useUserStore((s) => s.user);
  const hydrated = useHydrated();
  const startMusic = useMusicStore((s) => s.start);
  const touch = useIsTouch();
  const portrait = useIsPortrait();
  const [started, setStarted] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const [portraitOk, setPortraitOk] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (hydrated && !user) router.replace("/#giris");
  }, [hydrated, user, router]);

  useEffect(() => {
    const on = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);

  const GameComponent = GAME_COMPONENTS[game.slug];

  const begin = () => {
    startMusic();
    setStarted(true);
    if (touch) void enterLandscapeFullscreen();
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void enterLandscapeFullscreen();
  };

  return (
    <main className="relative h-dvh w-full touch-none overflow-hidden overscroll-none bg-[#c9d4de] select-none">
      {hydrated && user && <GameComponent started={started} />}

      {/* top-left: way back + where you are (compact on phones) */}
      <div className="absolute left-[max(1rem,env(safe-area-inset-left))] top-4 z-30 flex items-center gap-2 short:left-[max(0.75rem,env(safe-area-inset-left))] short:top-[max(0.625rem,env(safe-area-inset-top))] short:gap-1.5 narrow:gap-1.5">
        <Link
          href="/games"
          aria-label="Oyunlara dön"
          className="inline-flex h-10 items-center gap-2 rounded-full border border-line bg-paper/95 pl-3 pr-4 text-[14px] font-medium text-ink backdrop-blur hover:border-ink short:size-9 short:justify-center short:p-0 narrow:size-9 narrow:justify-center narrow:p-0"
        >
          <ArrowLeft className="size-4" />
          <span className="short:hidden narrow:hidden">Oyunlar</span>
        </Link>
        <span className="inline-flex h-10 items-center rounded-full bg-ink px-4 text-[14px] font-semibold tracking-[-0.01em] text-paper ring-1 ring-white/30 short:h-9 short:px-3 short:text-[13px] narrow:h-9 narrow:px-3 narrow:text-[13px]">
          {game.title}
        </span>
        {touch && canFullscreen() && (
          <button
            type="button"
            onClick={toggleFullscreen}
            aria-label={fullscreen ? "Tam ekrandan çık" : "Tam ekran"}
            className="grid size-10 place-items-center rounded-full border border-line bg-paper/95 text-ink backdrop-blur short:size-9 narrow:size-9"
          >
            {fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </button>
        )}
      </div>

      {/* touch controls, or the keyboard reference on desktop */}
      {started && touch && <TouchControls slug={game.slug} />}
      {started && !touch && (
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

      {/* start sheet (landscape phones: two columns so it fits without scrolling) */}
      {!started && (
        <div className="absolute inset-0 z-30 flex items-end overflow-y-auto bg-paper/55 backdrop-blur-[6px] sm:items-center short:items-center">
          <div className="mx-auto w-full max-w-[1180px] px-4 pb-24 pt-20 sm:px-10 sm:pb-0 short:px-[max(1rem,env(safe-area-inset-left))] short:py-3 short:pt-14">
            <div className="max-w-[34rem] rounded-[28px] bg-paper p-7 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.35)] sm:p-10 short:mx-auto short:grid short:max-w-[46rem] short:grid-cols-[1fr_1.05fr] short:gap-x-7 short:rounded-[22px] short:p-5 narrow:p-6 animate-fade-up">
              <div>
                <p className="text-[15px] text-muted-ink short:hidden">{game.subtitle}</p>
                <h1 className="display mt-2 text-[clamp(3.2rem,7vw,5.5rem)] short:mt-0 short:text-[clamp(2rem,9dvh,2.6rem)] narrow:text-[2.9rem]">{game.title}</h1>
                <p className="mt-5 text-[16px] leading-[1.55] text-ink short:mt-2 short:text-[13.5px] short:leading-[1.45] narrow:mt-4 narrow:text-[15px]">{game.description}</p>
                <p className="mt-3 text-[15px] leading-[1.55] text-muted-ink short:hidden narrow:text-[14px]">{game.goal}</p>
              </div>
              <div className="short:flex short:flex-col short:justify-between">
                {touch ? (
                  <ul className="mt-6 grid gap-1.5 text-[14px] text-ink short:mt-0 short:gap-1 short:text-[12.5px] short:leading-[1.35]">
                    {TOUCH_HELP[game.slug].map((line) => (
                      <li key={line} className="flex gap-2">
                        <span aria-hidden className="mt-[0.45em] size-1.5 shrink-0 rounded-full bg-yellow" />
                        {line}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <ControlsList game={game} className="mt-6 short:mt-0" />
                )}
                <div className="mt-8 short:mt-3 narrow:mt-6">
                  <Pill onClick={begin} small={touch}>
                    Başlat
                  </Pill>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* phones held upright: suggest landscape (can be dismissed) */}
      {touch && portrait && !portraitOk && (
        <div className="absolute inset-0 z-40 grid place-items-center bg-paper px-8 text-center">
          <div>
            <div aria-hidden className="mx-auto mb-6 h-16 w-10 rotate-90 rounded-[10px] border-[3px] border-ink" />
            <p className="display-2 text-[2rem]">Telefonu yan çevir.</p>
            <p className="mt-3 text-[15px] leading-[1.5] text-muted-ink">Kontroller iki başparmakla, yatay ekranda çok daha rahat.</p>
            <button
              type="button"
              onClick={() => setPortraitOk(true)}
              className="mt-8 text-[15px] font-medium text-ink underline underline-offset-4"
            >
              Dikey devam et
            </button>
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
