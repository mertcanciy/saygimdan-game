"use client";

// The song player. One instance for the whole site (it lives outside React so
// a tap handler can start playback synchronously: mobile browsers only let
// media start with sound inside the user's gesture, and anything async in
// between — a fetch, a script load, a React effect — loses it).
//
// The song is the official YouTube video, played in a standard, VISIBLE
// YouTube embed (YouTube API Services Developer Policies III.I: no hidden /
// background player, no separating the audio, nothing laid over the player,
// ≥ 200×200 px viewport). The site never hosts the audio. Rules this file
// keeps:
//   - the player is on screen (`open`) whenever it plays: playback opens it,
//     closing it pauses (`close()`), and a hidden tab pauses it;
//   - YouTube's own controls stay on (no `controls: 0`);
//   - if the browser refuses a scripted start (`blocked`), the visitor starts
//     it with the play button inside the (visible) player.
// The dock (components/SongDock.tsx) renders the player's box and hands it
// over with `attach()`; the iframe is created inside it and never moves.

import { create } from "zustand";
import { MUSIC } from "./music";
import { isTouchDevice } from "@/components/games/shared/input";

export type MusicMode = "idle" | "loading" | "youtube" | "missing" | "error";

interface YTPlayer {
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo?: (s: number, allow: boolean) => void;
  destroy?: () => void;
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
  /** a play request was refused by the browser: the play button inside the player has to start it */
  blocked: boolean;
  /** asked to play, not audible yet (the player is still starting / buffering) */
  pending: boolean;
  /** the player is on screen (it only ever plays while this is true) */
  open: boolean;
  /** put away for now (sign-in sheet, paused game on a phone): hidden and paused */
  held: boolean;
  /**
   * The visitor's last choice, remembered on the device: the game's Başlat also
   * starts the song. Opening the player turns it on, closing it turns it off.
   */
  songOn: boolean;
  setSongOn: (on: boolean) => void;
  /** Open the player and start the song. Call it straight from a click / tap handler. */
  start: () => void;
  /** Play / pause from the dock (a pause here is remembered as the visitor's choice). */
  toggle: () => void;
  /** Put the player away (pauses the song: it never plays hidden). */
  close: () => void;
}

const YT_API = "https://www.youtube.com/iframe_api";
const SONG_ON_KEY = "saygimdan-song-on";

function readSongOn(): boolean {
  try {
    return localStorage.getItem(SONG_ON_KEY) !== "0";
  } catch {
    return true;
  }
}

function writeSongOn(on: boolean) {
  try {
    localStorage.setItem(SONG_ON_KEY, on ? "1" : "0");
  } catch {
    /* private mode: just this visit */
  }
}
/** a play request that hasn't produced sound after this long counts as blocked */
const BLOCK_MS = 2500;

class MusicEngine {
  private yt: YTPlayer | null = null;
  /** the dock's player box (stays mounted for the whole visit) */
  private mount: HTMLElement | null = null;
  /** last YouTube player state (3 = buffering: trying, not blocked) */
  private ytState = -1;
  private preparing: Promise<void> | null = null;
  /** prepare() was asked for before the dock handed over its box */
  private pendingPrepare = false;
  /** the visitor wants the song on (survives browser-initiated pauses) */
  private want = false;
  /** paused on purpose from the dock: don't auto-resume */
  private userPaused = false;
  /** why the player is put away for now (the sign-in sheet over it, a paused game on a phone) */
  private holds = new Set<string>();
  private get held() {
    return this.holds.size > 0;
  }
  private blockTimer: ReturnType<typeof setTimeout> | null = null;
  private bound = false;

  private get s() {
    return useMusicStore.getState();
  }

  private set(p: Partial<MusicState>) {
    useMusicStore.setState(p);
  }

  /** The dock's player box. The iframe is built inside it and never moved (moving reloads it). */
  attach(el: HTMLElement | null) {
    this.mount = el;
    if (el && this.pendingPrepare) {
      this.pendingPrepare = false;
      void this.prepare();
    }
  }

  /** Build the (paused) player. Idempotent. */
  prepare(): Promise<void> {
    // desktop only: no song (and no YouTube download) on touch devices
    if (typeof window === "undefined" || isTouchDevice()) return Promise.resolve();
    if (!MUSIC.youtubeId) {
      this.set({ mode: "missing" });
      return Promise.resolve();
    }
    if (!this.mount) {
      this.pendingPrepare = true;
      return Promise.resolve();
    }
    this.bindPageEvents();
    this.preparing ??= this.build().catch((e) => {
      console.warn("music: player failed to load", e);
      this.preparing = null;
      this.set({ mode: "error", ready: false });
    });
    return this.preparing;
  }

  private async build() {
    this.set({ mode: "loading" });
    await loadYouTubeApi();
    const mount = this.mount;
    if (!mount) throw new Error("player box went away");
    await new Promise<void>((resolve, reject) => {
      // the API replaces this element with the iframe
      mount.replaceChildren();
      const el = document.createElement("div");
      mount.appendChild(el);
      let settled = false;
      const timeout = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        mount.replaceChildren();
        reject(new Error("YouTube player did not become ready"));
      }, 12000);
      let player: YTPlayer;
      try {
        player = new window.YT!.Player(el, {
          width: "100%",
          height: "100%",
          videoId: MUSIC.youtubeId,
          playerVars: { loop: 1, playlist: MUSIC.youtubeId, playsinline: 1, rel: 0 },
          events: {
            onReady: () => {
              if (settled) return;
              settled = true;
              window.clearTimeout(timeout);
              this.yt = player;
              this.set({ mode: "youtube", ready: true });
              // asked to play before the player existed: try now (may be refused → blocked)
              if (this.want && !this.userPaused && !this.held) this.startNow();
              resolve();
            },
            onStateChange: (e: { data: number }) => {
              // -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued
              this.ytState = e.data;
              if (e.data === 1) this.onPlaying();
              else if (e.data === 0) {
                player.seekTo?.(0, true);
                player.playVideo();
              } else if (e.data === 2) {
                const wasPlaying = this.s.playing;
                this.set({ playing: false });
                // our own pauses (dock, hidden tab, sign-in sheet) are already accounted for
                if (!this.want || this.held || document.visibilityState !== "visible") return;
                if (wasPlaying) {
                  // paused from YouTube's own controls: that's the visitor's choice too
                  this.want = false;
                  this.userPaused = true;
                  this.set({ pending: false });
                } else {
                  // paused before it ever played: the browser refused the start
                  this.refused();
                }
              }
            },
            onAutoplayBlocked: () => {
              if (this.want) this.refused();
            },
          },
        });
      } catch (error) {
        window.clearTimeout(timeout);
        mount.replaceChildren();
        reject(error);
      }
    });
  }

  private onPlaying() {
    if (this.blockTimer) clearTimeout(this.blockTimer);
    this.blockTimer = null;
    // (may have been started from the player's own play button)
    this.want = true;
    this.userPaused = false;
    // never audible while hidden: whatever started it, the player is on screen
    this.set({ playing: true, blocked: false, pending: false, started: true, open: true });
  }

  /** The browser didn't let us start it: the visitor presses play inside the player. */
  private refused() {
    if (this.blockTimer) clearTimeout(this.blockTimer);
    this.blockTimer = null;
    this.set({ blocked: true, pending: false, playing: false });
  }

  /** The synchronous part of starting playback. */
  private startNow() {
    if (!this.yt) return;
    this.set({ open: true, pending: true });
    this.yt.playVideo();
    this.armBlockTimer(BLOCK_MS);
  }

  private armBlockTimer(ms: number) {
    if (this.blockTimer) clearTimeout(this.blockTimer);
    this.blockTimer = setTimeout(() => {
      this.blockTimer = null;
      if (!this.want || this.s.playing) return;
      // still buffering on a slow connection: that's not a refusal
      if (this.ytState === 3) this.armBlockTimer(1500);
      else this.refused();
    }, ms);
  }

  /** Stop the sound without changing what the visitor asked for. */
  private silence() {
    if (this.blockTimer) clearTimeout(this.blockTimer);
    this.blockTimer = null;
    try {
      this.yt?.pauseVideo();
    } catch {
      /* player not ready yet */
    }
    this.set({ playing: false, pending: false });
  }

  play() {
    if (isTouchDevice()) return;
    this.want = true;
    this.userPaused = false;
    this.rememberSongOn(true);
    this.set({ started: true, blocked: false, open: true });
    if (this.s.playing || this.held) return;
    if (this.yt) this.startNow();
    else void this.prepare();
  }

  pause() {
    this.want = false;
    this.userPaused = true;
    this.silence();
    this.set({ blocked: false });
  }

  close() {
    this.pause();
    this.rememberSongOn(false);
    this.set({ open: false });
  }

  /** The game's Başlat / Devam et: plays when the visitor wants the song with the game. */
  playWithGame() {
    if (this.s.songOn) this.play();
  }

  rememberSongOn(on: boolean) {
    if (this.s.songOn === on) return;
    writeSongOn(on);
    this.set({ songOn: on });
  }

  /**
   * Put the player away for a while without changing what the visitor asked
   * for: it pauses and hides, and picks up again once every hold is released.
   * Release from inside a tap handler when the song should resume right away
   * (phones only start sound inside the tap).
   */
  hold(reason: string, on: boolean) {
    const was = this.held;
    if (on) this.holds.add(reason);
    else this.holds.delete(reason);
    if (this.held === was) return;
    this.set({ held: this.held });
    if (this.held) this.silence();
    else if (this.want && !this.userPaused && this.yt) this.startNow();
  }

  private bindPageEvents() {
    if (this.bound) return;
    this.bound = true;
    // no playing from a tab nobody is looking at; pick up again on return
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") this.silence();
      else if (this.want && !this.userPaused && !this.held && !this.s.playing) this.startNow();
    });
  }
}

let ytApi: Promise<void> | null = null;
function loadYouTubeApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  ytApi ??= new Promise<void>((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      ytApi = null;
      window.onYouTubeIframeAPIReady = prev;
      document.querySelector<HTMLScriptElement>(`script[src="${YT_API}"]`)?.remove();
      reject(error);
    };
    const timeout = window.setTimeout(() => fail(new Error("YouTube API timed out")), 12000);
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      resolve();
    };
    const tag = document.querySelector<HTMLScriptElement>(`script[src="${YT_API}"]`) ?? document.createElement("script");
    tag.src = YT_API;
    tag.async = true;
    tag.onerror = () => fail(new Error("YouTube API failed to load"));
    if (!tag.isConnected) document.body.appendChild(tag);
  });
  return ytApi;
}

export const music = new MusicEngine();

// dev-only handle for headless tests
if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
  (window as unknown as { __music?: unknown }).__music = () => useMusicStore.getState();
}

/** Global song state + actions (the dock, the landing's record and the game shell use it). */
export const useMusicStore = create<MusicState>()((_set, get) => ({
  started: false,
  playing: false,
  mode: "idle",
  ready: false,
  blocked: false,
  pending: false,
  open: false,
  held: false,
  songOn: typeof window === "undefined" ? true : readSongOn(),
  setSongOn: (on) => {
    music.rememberSongOn(on);
    if (!on) music.close();
  },
  start: () => music.play(),
  toggle: () => (get().playing ? music.pause() : music.play()),
  close: () => music.close(),
}));
