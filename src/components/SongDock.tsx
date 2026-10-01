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
 *
 * Desktop only: on touch devices there's no song at all (a ≥ 200×200 YouTube
 * player, which is the minimum YouTube allows, covers too much of a phone screen
 * mid-game). The movable, phone-aware version is parked on the
 * feat/movable-song-player branch.
 */
export default function SongDock() {
  const { playing, pending, mode, blocked, open, held, start, close } = useMusicStore();
  const pathname = usePathname();
  const touch = useIsTouch();
  const inGame = pathname.startsWith("/play");

  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    music.attach(box.current);
    return () => music.attach(null);
  }, []);

  // Build the player before anyone presses play, so the press itself can start
  // it synchronously. Game pages: right away. Elsewhere: on the first
  // interaction (no YouTube download for visitors who only look).
  useEffect(() => {
    if (touch) return;
    if (inGame) {
      void music.prepare();
      return;
    }
    const go = () => void music.prepare();
    const evs = ["pointerdown", "keydown", "scroll"] as const;
    evs.forEach((e) => window.addEventListener(e, go, { once: true, passive: true }));
    return () => evs.forEach((e) => window.removeEventListener(e, go));
  }, [inGame, touch]);

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

  if (touch || mode === "missing") return null;

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

  // in a game the open player takes the stats' place in the top-right corner (the
  // HUD shrinks to the score, which moves to its left: GameHud → HudStack)
  const placement = inGame && open ? "top-4 right-4" : "bottom-4 right-4";

  const statusLine = status && (
    <div className={`max-w-[356px] px-3 py-1.5 text-[11.5px] leading-snug ${blocked || mode === "error" ? "font-semibold text-red" : "text-muted-ink"}`}>
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
        <div className="flex items-center gap-2 py-1.5 pl-3 pr-1.5">
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-[12.5px] font-semibold tracking-[-0.01em]">
              {MUSIC.artist}, {MUSIC.title}
            </div>
            <div className="truncate text-[11px] text-muted-ink">Resmi video, YouTube&apos;dan</div>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Oynatıcıyı kapat (şarkı durur)"
            title="Kapat (şarkı durur)"
            className="grid size-8 shrink-0 place-items-center rounded-full hover:bg-soft"
          >
            <X className="size-4" />
          </button>
        </div>
        {/* YouTube asks for at least 200×200 */}
        <div ref={box} className="h-[200px] w-[356px] bg-ink" />
        {statusLine}
      </div>

      {!open && (
        <button
          type="button"
          onClick={start}
          aria-label={`Şarkıyı aç: ${MUSIC.artist}, ${MUSIC.title}`}
          className={`flex items-center rounded-full border border-line text-ink ${
            // over a live game canvas a backdrop blur is recomputed every frame: skip it there
            inGame ? "bg-paper/95" : "bg-paper/95 backdrop-blur"
          } gap-3 py-1.5 pl-1.5 pr-4 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.25)]`}
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-red text-paper">
            <Play className="size-4 translate-x-px fill-current" />
          </span>
          <span className="min-w-0 text-left leading-tight">
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
