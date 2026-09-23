"use client";

import { useEffect, useRef, useState } from "react";
import { MUSIC } from "@/lib/music";

declare global {
  interface Window {
    YT?: {
      Player: new (
        el: HTMLElement,
        opts: Record<string, unknown>
      ) => YTPlayer;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

interface YTPlayer {
  playVideo: () => void;
  pauseVideo: () => void;
  setVolume: (v: number) => void;
}

export default function MusicPlayer({ started }: { started: boolean }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ytRef = useRef<YTPlayer | null>(null);
  const ytContainerRef = useRef<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<"pending" | "audio" | "youtube" | "missing">(
    "pending"
  );
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(0.8);

  useEffect(() => {
    if (!started || mode !== "pending") return;

    let cancelled = false;

    const init = async () => {
      try {
        const res = await fetch(MUSIC.mp3, { method: "HEAD" });
        if (res.ok) {
          if (cancelled) return;
          const audio = new Audio(MUSIC.mp3);
          audio.loop = true;
          audio.volume = volume;
          audioRef.current = audio;
          setMode("audio");
          audio
            .play()
            .then(() => setPlaying(true))
            .catch(() => setPlaying(false));
          return;
        }
      } catch {
        // fall through to youtube
      }

      if (MUSIC.youtubeId) {
        if (cancelled) return;
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
            },
            events: {
              onReady: () => {
                ytRef.current?.setVolume(Math.round(volume * 100));
                ytRef.current?.playVideo();
                setPlaying(true);
              },
              onStateChange: (e: { data: number }) => {
                if (e.data === 0) ytRef.current?.playVideo();
              },
            },
          });
          setMode("youtube");
        };
        if (window.YT) {
          createPlayer();
        } else {
          window.onYouTubeIframeAPIReady = createPlayer;
          const tag = document.createElement("script");
          tag.src = "https://www.youtube.com/iframe_api";
          document.body.appendChild(tag);
        }
        return;
      }

      if (!cancelled) setMode("missing");
    };

    init();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
    ytRef.current?.setVolume(Math.round(volume * 100));
  }, [volume]);

  const toggle = () => {
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

  return (
    <div className="flex items-center gap-3 rounded-full border border-white/15 bg-black/60 backdrop-blur px-4 py-2 text-white">
      {/* hidden 1x1 youtube player */}
      <div
        ref={ytContainerRef}
        className="absolute h-px w-px overflow-hidden opacity-0 pointer-events-none"
      />

      {/* equalizer */}
      <div className="flex items-end gap-[3px] h-4" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className="w-[3px] rounded-sm bg-fuchsia-400 origin-bottom"
            style={{
              height: "100%",
              animation: playing
                ? `eq ${0.5 + i * 0.13}s ease-in-out ${i * 0.1}s infinite alternate`
                : "none",
              transform: playing ? undefined : "scaleY(0.3)",
            }}
          />
        ))}
      </div>

      <span className="text-xs text-white/80 whitespace-nowrap">
        {MUSIC.title}
      </span>

      {mode === "missing" ? (
        <span className="text-[10px] text-amber-400/90 max-w-45 leading-tight">
          Şarkı dosyası bulunamadı: public/audio/saygimdan.mp3 ekleyin
        </span>
      ) : (
        <>
          <button
            onClick={toggle}
            className="text-white/80 hover:text-white text-sm cursor-pointer"
            aria-label={playing ? "Duraklat" : "Oynat"}
          >
            {playing ? "⏸" : "▶"}
          </button>
          {mode !== "pending" && (
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              className="w-16 accent-fuchsia-400"
              aria-label="Ses"
            />
          )}
        </>
      )}

      <style jsx>{`
        @keyframes eq {
          from {
            transform: scaleY(0.25);
          }
          to {
            transform: scaleY(1);
          }
        }
      `}</style>
    </div>
  );
}
