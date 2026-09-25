"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import { MUSIC } from "@/lib/music";
import { useMusicStore } from "@/lib/store";
import { useIsTouch } from "@/components/games/shared/useDevice";

declare global {
  interface Window {
    YT?: {
      Player: new (el: HTMLElement, opts: Record<string, unknown>) => YTPlayer;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

interface YTPlayer {
  playVideo: () => void;
  pauseVideo: () => void;
  setVolume: (v: number) => void;
  seekTo?: (s: number, allow: boolean) => void;
}

type Mode = "idle" | "loading" | "audio" | "youtube" | "missing";

/**
 * The song, always within reach. Mounted once in the root layout so it keeps
 * playing while you move from the landing page to the games and back.
 * Local mp3 (public/audio/saygimdan.mp3) first, YouTube as fallback.
 */
export default function SongDock() {
  const started = useMusicStore((s) => s.started);
  const start = useMusicStore((s) => s.start);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ytRef = useRef<YTPlayer | null>(null);
  const ytContainerRef = useRef<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<Mode>("idle");
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [muted, setMuted] = useState(false);
  const volRef = useRef(volume);
  // in-game on a phone the corners belong to the thumbs: shrink to a small round button between them
  const pathname = usePathname();
  const touch = useIsTouch();
  const compact = touch && pathname.startsWith("/play");
  const initRef = useRef(false);

  useEffect(() => {
    if (!started || initRef.current) return;
    initRef.current = true;
    const cancelled = false;
    setMode("loading");

    const init = async () => {
      try {
        const res = await fetch(MUSIC.mp3, { method: "HEAD" });
        const type = res.headers.get("content-type") ?? "";
        if (res.ok && type.startsWith("audio")) {
          if (cancelled) return;
          const audio = new Audio(MUSIC.mp3);
          audio.loop = true;
          audio.volume = volRef.current;
          audioRef.current = audio;
          setMode("audio");
          audio
            .play()
            .then(() => setPlaying(true))
            .catch(() => setPlaying(false));
          return;
        }
      } catch {
        // fall through to YouTube
      }

      if (!MUSIC.youtubeId) {
        if (!cancelled) setMode("missing");
        return;
      }
      const createPlayer = () => {
        if (cancelled || !window.YT || !ytContainerRef.current) return;
        ytRef.current = new window.YT.Player(ytContainerRef.current, {
          width: "1",
          height: "1",
          videoId: MUSIC.youtubeId,
          playerVars: {
            loop: 1,
            playlist: MUSIC.youtubeId,
            autoplay: 1,
            controls: 0,
            disablekb: 1,
            playsinline: 1,
          },
          events: {
            onReady: () => {
              ytRef.current?.setVolume(Math.round(volRef.current * 100));
              ytRef.current?.playVideo();
            },
            onStateChange: (e: { data: number }) => {
              // 0 ended → loop, 1 playing, 2 paused
              if (e.data === 0) {
                ytRef.current?.seekTo?.(0, true);
                ytRef.current?.playVideo();
              } else if (e.data === 1) setPlaying(true);
              else if (e.data === 2) setPlaying(false);
            },
          },
        });
        setMode("youtube");
      };
      if (window.YT?.Player) createPlayer();
      else {
        const prev = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = () => {
          prev?.();
          createPlayer();
        };
        if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
          const tag = document.createElement("script");
          tag.src = "https://www.youtube.com/iframe_api";
          document.body.appendChild(tag);
        }
      }
    };

    // the dock lives in the root layout and never unmounts, so no cancellation
    // (a cleanup here would also break React's dev double-invoke)
    init();
  }, [started]);

  useEffect(() => {
    const v = muted ? 0 : volume;
    volRef.current = v;
    if (audioRef.current) audioRef.current.volume = v;
    try {
      ytRef.current?.setVolume(Math.round(v * 100));
    } catch {
      /* player not ready yet */
    }
  }, [volume, muted]);

  const toggle = () => {
    if (!started) {
      start();
      return;
    }
    if (mode === "audio" && audioRef.current) {
      if (playing) {
        audioRef.current.pause();
        setPlaying(false);
      } else {
        audioRef.current
          .play()
          .then(() => setPlaying(true))
          .catch(() => setPlaying(false));
      }
    } else if (mode === "youtube" && ytRef.current) {
      if (playing) {
        ytRef.current.pauseVideo();
        setPlaying(false);
      } else {
        ytRef.current.playVideo();
        setPlaying(true);
      }
    }
  };

  const status =
    mode === "idle"
      ? "Dinlemek için bas"
      : mode === "loading"
        ? "Yükleniyor"
        : mode === "missing"
          ? "Şarkı dosyası bulunamadı"
          : playing
            ? "Çalıyor, başa sarar"
            : "Durdu";

  return (
    <div
      className={`fixed z-50 flex items-center rounded-full border border-line text-ink backdrop-blur ${
        compact
          ? // portrait: the bottom edge is all thumbs, so park it on the right above the button arc
            "bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 gap-0 bg-paper/80 p-1 shadow-[0_6px_18px_-10px_rgba(0,0,0,0.4)] narrow:bottom-[calc(max(1.5rem,env(safe-area-inset-bottom))+14rem)] narrow:left-auto narrow:right-[max(1rem,env(safe-area-inset-right))] narrow:translate-x-0"
          : "bottom-4 right-4 gap-3 bg-paper/95 py-1.5 pl-1.5 pr-4 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.25)] narrow:bottom-3 narrow:right-3 narrow:gap-2.5 narrow:pr-3.5"
      }`}
      role="region"
      aria-label="Şarkı çalar"
    >
      <div ref={ytContainerRef} className="pointer-events-none absolute h-px w-px overflow-hidden opacity-0" />

      <button
        type="button"
        onClick={toggle}
        disabled={mode === "loading" || mode === "missing"}
        aria-label={playing ? "Duraklat" : "Çal"}
        className={`relative grid shrink-0 place-items-center rounded-full bg-yellow text-ink transition-transform active:scale-95 disabled:opacity-60 ${
          compact ? "size-9" : "size-10"
        }`}
      >
        {playing ? (
          <Pause className={`fill-current ${compact ? "size-3.5" : "size-4"}`} />
        ) : (
          <Play className={`translate-x-px fill-current ${compact ? "size-3.5" : "size-4"}`} />
        )}
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
        <div className="text-[11.5px] text-muted-ink whitespace-nowrap">{status}</div>
      </div>

      {!compact && (mode === "audio" || mode === "youtube") && (
        <div className="hidden sm:flex items-center gap-2 pl-1">
          <button
            type="button"
            onClick={() => setMuted((m) => !m)}
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
            onChange={(e) => {
              setMuted(false);
              setVolume(Number(e.target.value));
            }}
            aria-label="Ses seviyesi"
            className="h-1 w-20 cursor-pointer accent-[#0a0a0a]"
          />
        </div>
      )}
    </div>
  );
}
