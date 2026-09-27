"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import { music, useMusicStore } from "@/lib/musicEngine";
import { useIsTouch } from "@/components/games/shared/useDevice";

/**
 * The song, always within reach. Mounted once in the root layout so it keeps
 * playing while you move from the landing page to the games and back.
 * The player itself is lib/musicEngine.ts; this is its remote control.
 */
export default function SongDock() {
  const { started, playing, mode, blocked, volume, muted, toggle, setVolume, setMuted } = useMusicStore();
  // in-game on a phone the corners belong to the thumbs: shrink to a small round button between them
  const pathname = usePathname();
  const touch = useIsTouch();
  const inGame = pathname.startsWith("/play");
  const compact = touch && inGame;

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

  // the browser refused to start YouTube for us: put the (invisible) player
  // itself under the play button, so the tap goes straight to YouTube
  const playBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!blocked || mode !== "youtube") return;
    const place = () => {
      const b = playBtn.current;
      if (b) music.setTapTarget(b.getBoundingClientRect());
    };
    // after the dock's own layout transition settles
    const t = setTimeout(place, 50);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, { passive: true });
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place);
      music.setTapTarget(null);
    };
  }, [blocked, mode, compact]);

  const status =
    mode === "missing"
      ? "Şarkı dosyası bulunamadı"
      : blocked
        ? "Başlatmak için dokun"
        : playing
          ? "Çalıyor, başa sarar"
          : !started
            ? "Dinlemek için bas"
            : mode === "loading"
              ? "Yükleniyor"
              : "Durdu";

  return (
    <div
      className={`fixed z-50 flex items-center rounded-full border border-line text-ink ${
        // over a live game canvas a backdrop blur is recomputed every frame: skip it there
        inGame ? "" : "backdrop-blur"
      } ${
        compact
          ? // portrait with the thumb controls up (PlayShell sets data-touch-controls): the bottom
            // edge is all thumbs, so park it on the right above the right-hand controls
            "bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 gap-0 bg-paper/90 p-1 shadow-[0_6px_18px_-10px_rgba(0,0,0,0.4)] [[data-touch-controls]_&]:narrow:bottom-[calc(max(1.5rem,env(safe-area-inset-bottom))+15.5rem)] [[data-touch-controls]_&]:narrow:left-auto [[data-touch-controls]_&]:narrow:right-[max(1rem,env(safe-area-inset-right))] [[data-touch-controls]_&]:narrow:translate-x-0"
          : "bottom-4 right-4 gap-3 bg-paper/95 py-1.5 pl-1.5 pr-4 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.25)] narrow:bottom-3 narrow:right-3 narrow:gap-2.5 narrow:pr-3.5"
      }`}
      role="region"
      aria-label="Şarkı çalar"
    >
      {/* the browser refused to start the song on its own: say what to do, right where to do it */}
      {blocked && compact && (
        <span className="pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap rounded-full bg-ink px-3 py-1.5 text-[12.5px] font-semibold text-paper shadow-[0_6px_18px_-8px_rgba(0,0,0,0.5)] animate-fade-up [[data-touch-controls]_&]:narrow:left-auto [[data-touch-controls]_&]:narrow:right-0 [[data-touch-controls]_&]:narrow:translate-x-0">
          Şarkı için dokun
        </span>
      )}

      <button
        ref={playBtn}
        type="button"
        onClick={toggle}
        disabled={mode === "missing"}
        aria-label={playing ? "Duraklat" : "Çal"}
        className={`relative grid shrink-0 place-items-center rounded-full bg-red text-paper transition-[transform,background-color] hover:bg-red-deep active:scale-95 disabled:opacity-60 ${
          compact ? "size-11" : "size-10"
        }`}
      >
        {blocked && <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-red/60" />}
        {playing ? <Pause className="relative size-4 fill-current" /> : <Play className="relative size-4 translate-x-px fill-current" />}
      </button>

      <div className={`h-4 items-end gap-[3px] ${compact ? "hidden" : "flex"}`} aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className="w-[3px] rounded-[1px] bg-ink origin-bottom"
            style={{
              height: "100%",
              animation: playing ? `eq ${0.45 + i * 0.12}s ease-in-out ${i * 0.08}s infinite alternate` : "none",
              transform: playing ? undefined : "scaleY(0.3)",
            }}
          />
        ))}
      </div>

      <div className={`min-w-0 leading-tight ${compact ? "hidden" : ""}`}>
        <div className="text-[13px] font-semibold tracking-[-0.01em] whitespace-nowrap">Bengü, Saygımdan</div>
        <div className={`text-[11.5px] whitespace-nowrap ${blocked ? "font-semibold text-red" : "text-muted-ink"}`}>{status}</div>
      </div>

      {!compact && (mode === "audio" || mode === "youtube") && (
        <div className="hidden sm:flex items-center gap-2 pl-1">
          <button
            type="button"
            onClick={() => setMuted(!muted)}
            aria-label={muted ? "Sesi aç" : "Sessize al"}
            className="grid size-8 place-items-center rounded-full hover:bg-soft"
          >
            {muted || volume === 0 ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={muted ? 0 : volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            aria-label="Ses seviyesi"
            className="h-1 w-20 cursor-pointer accent-[#0a0a0a]"
          />
        </div>
      )}
    </div>
  );
}
