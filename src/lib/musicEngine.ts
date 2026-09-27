"use client";

// The song player. One instance for the whole site (it lives outside React so
// a tap handler can start playback synchronously: mobile browsers only let
// media start with sound inside the user's gesture, and anything async in
// between — a fetch, a script load, a React effect — loses it).
//
// Local mp3 (public/audio/saygimdan.mp3) first, a hidden YouTube player as
// fallback. `prepare()` decides which and builds the player ahead of time
// (paused), so that by the time someone presses play the actual start is a
// single synchronous call.
//
// Some browsers (strict mobile autoplay rules) still refuse a YouTube start
// requested from our page. Then the state goes `blocked`, the dock asks for a
// tap, and the invisible YouTube player is laid exactly over the dock's play
// button (`setTapTarget`): that tap lands inside YouTube itself, which is
// always allowed to start.

import { create } from "zustand";
import { MUSIC } from "./music";

export type MusicMode = "idle" | "loading" | "audio" | "youtube" | "missing";

interface YTPlayer {
  playVideo: () => void;
  pauseVideo: () => void;
  setVolume: (v: number) => void;
  seekTo?: (s: number, allow: boolean) => void;
  unMute?: () => void;
}

declare global {
  interface Window {
    YT?: {
      Player: new (el: HTMLElement, opts: Record<string, unknown>) => YTPlayer;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

interface MusicState {
  /** set once the visitor has pressed play somewhere */
  started: boolean;
  /** the song is audible right now */
  playing: boolean;
  mode: MusicMode;
  /** the player exists and can start instantly */
  ready: boolean;
  /** a play request was refused by the browser: the next tap has to start it */
  blocked: boolean;
  volume: number;
  muted: boolean;
  /** Start the song. Call it straight from a click / tap handler. */
  start: () => void;
  /** Play / pause from the dock (a pause here is remembered as the visitor's choice). */
  toggle: () => void;
  setVolume: (v: number) => void;
  setMuted: (m: boolean) => void;
  /** kept for the landing page's record (mirrors `playing`) */
  setPlaying: (p: boolean) => void;
}

const YT_API = "https://www.youtube.com/iframe_api";
/** a play request that hasn't produced sound after this long counts as blocked */
const BLOCK_MS = 2500;
/** YouTube asks for ≥ 200×200; it's invisible and click-through anyway */
const YT_SIZE = 200;
const HOST_HIDDEN = `position:fixed;left:0;bottom:0;width:${YT_SIZE}px;height:${YT_SIZE}px;opacity:0;pointer-events:none;z-index:-1;overflow:hidden;`;

class MusicEngine {
  private audio: HTMLAudioElement | null = null;
  private yt: YTPlayer | null = null;
  private host: HTMLDivElement | null = null;
  /** last YouTube player state (3 = buffering: trying, not blocked) */
  private ytState = -1;
  private preparing: Promise<void> | null = null;
  /** the visitor wants the song on (survives browser-initiated pauses) */
  private want = false;
  /** paused on purpose from the dock: don't auto-resume */
  private userPaused = false;
  private blockTimer: ReturnType<typeof setTimeout> | null = null;
  private bound = false;

  private get s() {
    return useMusicStore.getState();
  }

  private set(p: Partial<MusicState>) {
    useMusicStore.setState(p);
  }

  /** Pick mp3 or YouTube and build the player (paused). Idempotent. */
  prepare(): Promise<void> {
    if (typeof window === "undefined") return Promise.resolve();
    this.bindPageEvents();
    this.preparing ??= this.build().catch((e) => {
      console.warn("music: player failed to load", e);
    });
    return this.preparing;
  }

  private async build() {
    this.set({ mode: "loading" });
    if (await hasMp3()) {
      const a = new Audio(MUSIC.mp3);
      a.loop = true;
      a.preload = "auto";
      a.volume = this.effectiveVolume();
      a.addEventListener("playing", () => this.onPlaying());
      a.addEventListener("pause", () => this.set({ playing: false }));
      this.audio = a;
      this.set({ mode: "audio", ready: true });
      return;
    }
    if (!MUSIC.youtubeId) {
      this.set({ mode: "missing" });
      return;
    }
    await loadYouTubeApi();
    await new Promise<void>((resolve) => {
      const host = document.createElement("div");
      host.setAttribute("aria-hidden", "true");
      host.style.cssText = HOST_HIDDEN;
      const el = document.createElement("div");
      host.appendChild(el);
      document.body.appendChild(host);
      this.host = host;
      const player = new window.YT!.Player(el, {
        width: String(YT_SIZE),
        height: String(YT_SIZE),
        videoId: MUSIC.youtubeId,
        playerVars: { loop: 1, playlist: MUSIC.youtubeId, controls: 0, disablekb: 1, playsinline: 1, fs: 0, rel: 0 },
        events: {
          onReady: () => {
            this.yt = player;
            player.setVolume(Math.round(this.effectiveVolume() * 100));
            this.set({ mode: "youtube", ready: true });
            // asked to play before the player existed: try now (may be refused on iOS → blocked)
            if (this.want && !this.userPaused) this.startNow();
            resolve();
          },
          onStateChange: (e: { data: number }) => {
            // -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued
            this.ytState = e.data;
            if (e.data === 1) this.onPlaying();
            else if (e.data === 0) {
              player.seekTo?.(0, true);
              player.playVideo();
            } else if (e.data === 2) this.set({ playing: false });
          },
        },
      });
    });
  }

  private effectiveVolume() {
    return this.s.muted ? 0 : this.s.volume;
  }

  private onPlaying() {
    if (this.blockTimer) clearTimeout(this.blockTimer);
    this.blockTimer = null;
    // (may have been started by a tap on the YouTube player itself)
    this.want = true;
    this.userPaused = false;
    this.set({ playing: true, blocked: false, started: true });
  }

  /** The synchronous part of starting playback. */
  private startNow() {
    if (this.audio) {
      this.audio.play().catch(() => this.set({ blocked: true, playing: false }));
    } else if (this.yt) {
      this.yt.unMute?.();
      this.yt.playVideo();
    } else return;
    this.armBlockTimer(BLOCK_MS);
  }

  private armBlockTimer(ms: number) {
    if (this.blockTimer) clearTimeout(this.blockTimer);
    this.blockTimer = setTimeout(() => {
      this.blockTimer = null;
      if (!this.want || this.s.playing) return;
      // still buffering on a slow connection: that's not a refusal
      if (this.ytState === 3) this.armBlockTimer(1500);
      else this.set({ blocked: true });
    }, ms);
  }

  /**
   * While blocked, lay the invisible YouTube player over `r` (the dock's play
   * button) so the next tap there is a tap inside YouTube. null = hide it.
   */
  setTapTarget(r: DOMRect | null) {
    const h = this.host;
    if (!h) return;
    if (!r) {
      h.style.cssText = HOST_HIDDEN;
      return;
    }
    const size = Math.max(r.width, r.height);
    const k = size / YT_SIZE;
    h.style.cssText =
      `position:fixed;left:${r.left + r.width / 2 - size / 2}px;top:${r.top + r.height / 2 - size / 2}px;` +
      `width:${YT_SIZE}px;height:${YT_SIZE}px;transform:scale(${k});transform-origin:0 0;` +
      `border-radius:50%;overflow:hidden;opacity:0.01;pointer-events:auto;z-index:60;`;
  }

  play() {
    this.want = true;
    this.userPaused = false;
    this.set({ started: true, blocked: false });
    if (this.s.playing) return;
    if (this.audio || this.yt) this.startNow();
    else void this.prepare();
  }

  pause() {
    this.want = false;
    this.userPaused = true;
    if (this.blockTimer) clearTimeout(this.blockTimer);
    this.blockTimer = null;
    this.audio?.pause();
    this.yt?.pauseVideo();
    this.set({ playing: false, blocked: false });
  }

  /** Play unless the visitor paused it on purpose (e.g. the game's start button). */
  playUnlessPaused() {
    if (this.userPaused && this.s.started) return;
    this.play();
  }

  applyVolume() {
    const v = this.effectiveVolume();
    if (this.audio) this.audio.volume = v;
    try {
      this.yt?.setVolume(Math.round(v * 100));
    } catch {
      /* player not ready yet */
    }
  }

  private bindPageEvents() {
    if (this.bound) return;
    this.bound = true;
    // coming back to the tab (phones pause media when locked / switched away)
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && this.want && !this.userPaused && !this.s.playing) this.startNow();
    });
  }
}

async function hasMp3(): Promise<boolean> {
  try {
    const res = await fetch(MUSIC.mp3, { method: "HEAD" });
    return res.ok && (res.headers.get("content-type") ?? "").startsWith("audio");
  } catch {
    return false;
  }
}

let ytApi: Promise<void> | null = null;
function loadYouTubeApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  ytApi ??= new Promise<void>((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
    if (!document.querySelector(`script[src="${YT_API}"]`)) {
      const tag = document.createElement("script");
      tag.src = YT_API;
      tag.async = true;
      tag.onerror = () => reject(new Error("YouTube API failed to load"));
      document.body.appendChild(tag);
    }
  });
  return ytApi;
}

export const music = new MusicEngine();

// dev-only handle for headless tests
if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
  (window as unknown as { __music?: unknown }).__music = () => useMusicStore.getState();
}

/** Global song state + actions (the dock, the landing's record and the game shell use it). */
export const useMusicStore = create<MusicState>()((set, get) => ({
  started: false,
  playing: false,
  mode: "idle",
  ready: false,
  blocked: false,
  volume: 0.8,
  muted: false,
  start: () => music.play(),
  toggle: () => (get().playing ? music.pause() : music.play()),
  setVolume: (volume) => {
    set({ volume, muted: false });
    music.applyVolume();
  },
  setMuted: (muted) => {
    set({ muted });
    music.applyVolume();
  },
  setPlaying: (playing) => set({ playing }),
}));
