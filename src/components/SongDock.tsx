"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { Play, X } from "lucide-react";
import { music, useMusicStore } from "@/lib/musicEngine";
import { useLoginDialog } from "@/lib/store";
import { MUSIC } from "@/lib/music";
import { useIsTouch } from "@/components/games/shared/useDevice";

/**
 * The song, always within reach. Mounted once in the root layout so it keeps
 * playing while you move from the landing page to the games and back.
 *
 * Closed: a small button. Open: the YouTube player itself, on screen, with
 * YouTube's own controls (the song only ever plays while it's open; closing it
 * pauses). The player box below stays mounted for the whole visit — the
 * iframe lives in it (lib/musicEngine.ts) and moving it would reload it — so
 * only classes change between the states.
 */
export default function SongDock() {
  const { playing, pending, mode, blocked, open, held, start, close } = useMusicStore();
  // in-game on a phone the corners belong to the thumbs: sit between them
  const pathname = usePathname();
  const touch = useIsTouch();
  const inGame = pathname.startsWith("/play");
  const compact = touch && inGame;

  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    music.attach(box.current);
    return () => music.attach(null);
  }, []);

  // Build the player before anyone presses play, so the press itself can start
  // it synchronously. Game pages: right away. Elsewhere: on the first
  // interaction (no YouTube download for visitors who only look).
  useEffect(() => {
    if (inGame) {
      void music.prepare();
      return;
    }
    const go = () => void music.prepare();
    const evs = ["pointerdown", "keydown", "scroll"] as const;
    evs.forEach((e) => window.addEventListener(e, go, { once: true, passive: true }));
    return () => evs.forEach((e) => window.removeEventListener(e, go));
  }, [inGame]);

  // the sign-in sheet covers the player: no playing underneath it
  const loginOpen = useLoginDialog((s) => s.open);
  useEffect(() => music.hold("login", loginOpen), [loginOpen]);

  // in a game, the centred HUD text steps aside while the player is up (globals.css → .hud-avoid-song)
  const upInGame = inGame && open && !held ? pathname.split("/")[2] ?? "" : null;
  useEffect(() => {
    if (upInGame === null) return;
    const html = document.documentElement;
    html.dataset.songOpen = upInGame;
    return () => {
      delete html.dataset.songOpen;
    };
  }, [upInGame]);

  if (mode === "missing") return null;

  const status =
    mode === "error"
      ? "Oynatıcı yüklenemedi."
      : blocked
        ? "Başlatmak için oynatıcıdaki ▶ düğmesine dokun."
        : mode === "loading" || mode === "idle"
          ? "YouTube oynatıcısı yükleniyor…"
          : playing
            ? null
            : pending
              ? "Başlatılıyor…"
              : "Durdu. Oynatıcıdan devam edebilirsin.";

  // In a game the open player takes the stats' place at the top (the HUD shrinks
  // to the score: GameHud → HudStack), clear of the thumbs:
  //   wide screens: top-right corner, the score tile moves to its left;
  //   landscape phones: top, just left of the right-hand buttons (--song-gap per game, globals.css);
  //   portrait phones: top-right, under the score tile.
  const placement =
    inGame && open
      ? "top-4 right-4 short:top-[max(0.625rem,env(safe-area-inset-top))] short:right-[calc(max(0.75rem,env(safe-area-inset-right))+var(--song-gap))] narrow:top-[calc(max(0.625rem,env(safe-area-inset-top))+3rem)] narrow:right-[max(0.5rem,env(safe-area-inset-right))]"
      : compact
        ? // portrait with the thumb controls up (PlayShell sets data-touch-controls): the bottom
          // edge is all thumbs, so park it on the right above the right-hand controls
          "bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 items-center [[data-touch-controls]_&]:narrow:bottom-[calc(max(1.5rem,env(safe-area-inset-bottom))+15.5rem)] [[data-touch-controls]_&]:narrow:left-auto [[data-touch-controls]_&]:narrow:right-[max(1rem,env(safe-area-inset-right))] [[data-touch-controls]_&]:narrow:translate-x-0 [[data-touch-controls]_&]:narrow:items-end"
        : "bottom-4 right-4 narrow:bottom-3 narrow:right-3";

  // phones in a game: every pixel counts, so just the player (YouTube shows the title
  // in it); the close button sits beside it and the status hangs below it
  const bare = compact;
  const closeBtn = (
    <button
      type="button"
      onClick={close}
      aria-label="Oynatıcıyı kapat (şarkı durur)"
      title="Kapat (şarkı durur)"
      className={
        bare
          ? "absolute right-full top-0 mr-2 grid size-9 place-items-center rounded-full border border-line bg-paper/95 text-ink shadow-[0_6px_18px_-10px_rgba(0,0,0,0.4)]"
          : "grid size-8 shrink-0 place-items-center rounded-full hover:bg-soft phone:size-7"
      }
    >
      <X className="size-4" />
    </button>
  );
  const statusLine = status && (
    <div
      className={
        bare
          ? `absolute right-0 top-full mt-2 w-max max-w-[200px] rounded-xl bg-paper/95 px-2.5 py-1.5 text-[11.5px] leading-snug shadow-[0_6px_18px_-10px_rgba(0,0,0,0.4)] ${blocked || mode === "error" ? "font-semibold text-red" : "text-muted-ink"}`
          : `max-w-[356px] px-3 py-1.5 text-[11.5px] leading-snug phone:max-w-[200px] ${blocked || mode === "error" ? "font-semibold text-red" : "text-muted-ink"}`
      }
    >
      {status}
      {mode === "error" && (
        <button type="button" onClick={start} className="ml-1 underline underline-offset-2">
          Tekrar dene
        </button>
      )}
    </div>
  );

  return (
    <div
      className={`fixed z-[45] flex flex-col items-end ${placement} ${held ? "pointer-events-none invisible" : ""}`}
      role="region"
      aria-label="Şarkı çalar"
    >
      {/* the player card (kept in the DOM while closed: invisible and paused) */}
      <div
        aria-hidden={!open}
        className={`overflow-hidden rounded-2xl border border-line bg-paper text-ink shadow-[0_14px_40px_-16px_rgba(0,0,0,0.4)] ${
          open ? "" : "pointer-events-none invisible absolute bottom-0 right-0"
        }`}
      >
        {!bare && (
          <div className="flex items-center gap-2 py-1.5 pl-3 pr-1.5 phone:py-1 phone:pl-2.5 phone:pr-1">
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-[12.5px] font-semibold tracking-[-0.01em]">
                {MUSIC.artist}, {MUSIC.title}
              </div>
              <div className="truncate text-[11px] text-muted-ink phone:hidden">Resmi video, YouTube&apos;dan</div>
            </div>
            {closeBtn}
          </div>
        )}
        {/* YouTube asks for at least 200×200: 16:9 on wide screens, a square on phones */}
        <div ref={box} className="h-[200px] w-[356px] bg-ink phone:w-[200px]" />
        {!bare && statusLine}
      </div>
      {bare && open && closeBtn}
      {bare && open && statusLine}

      {!open && (
        <button
          type="button"
          onClick={start}
          aria-label={`Şarkıyı aç: ${MUSIC.artist}, ${MUSIC.title}`}
          className={`flex items-center rounded-full border border-line text-ink ${
            // over a live game canvas a backdrop blur is recomputed every frame: skip it there
            inGame ? "bg-paper/95" : "bg-paper/95 backdrop-blur"
          } ${
            compact
              ? "gap-0 p-1 shadow-[0_6px_18px_-10px_rgba(0,0,0,0.4)]"
              : "gap-3 py-1.5 pl-1.5 pr-4 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.25)] narrow:gap-2.5 narrow:pr-3.5"
          }`}
        >
          <span className={`grid shrink-0 place-items-center rounded-full bg-red text-paper ${compact ? "size-11" : "size-10"}`}>
            <Play className="size-4 translate-x-px fill-current" />
          </span>
          <span className={`min-w-0 text-left leading-tight ${compact ? "hidden" : ""}`}>
            <span className="block whitespace-nowrap text-[13px] font-semibold tracking-[-0.01em]">
              {MUSIC.artist}, {MUSIC.title}
            </span>
            <span className={`block whitespace-nowrap text-[11.5px] ${mode === "error" ? "font-semibold text-red" : "text-muted-ink"}`}>
              {mode === "error" ? "Yüklenemedi, tekrar dene" : "YouTube'da çal"}
            </span>
          </span>
        </button>
      )}
    </div>
  );
}
