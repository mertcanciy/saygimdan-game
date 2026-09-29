"use client";

/*
 * Points earned in one visit to a game, added to the leaderboard when the
 * player leaves (and on pause / app to background, so a killed tab doesn't
 * lose them). The games only report their HUD score: a drop (F-16 crash, R)
 * starts a new run, so earned = the sum of the score's increases.
 */
import { GameSlug } from "./games";
import { useUserStore } from "./store";

let game: GameSlug | null = null;
let last = 0;
let earned = 0;
let reported = 0;
let playMs = 0;
let reportedMs = 0;
let playingSince = 0;
const listeners = new Set<() => void>();

export function beginSession(slug: GameSlug) {
  game = slug;
  last = earned = reported = playMs = reportedMs = playingSince = 0;
  emit();
}

/** The game's current score (called when its HUD changes). */
export function trackScore(score: number) {
  if (!game || !Number.isFinite(score)) return;
  earned += score >= last ? score - last : score;
  last = score;
  emit();
}

/** Only time actually playing counts toward what the server accepts. */
export function setPlaying(on: boolean) {
  const now = performance.now();
  if (on && !playingSince) playingSince = now;
  if (!on && playingSince) {
    playMs += now - playingSince;
    playingSince = 0;
  }
}

export function sessionPoints() {
  return Math.round(earned);
}

/** Sends the points not reported yet. `beacon`: the page is going away. */
export function flushScore(beacon = false): Promise<void> {
  const token = useUserStore.getState().user?.token;
  if (!game || !token) return Promise.resolve();
  if (playingSince) {
    const now = performance.now();
    playMs += now - playingSince;
    playingSince = now;
  }
  const points = Math.round(earned - reported);
  const seconds = (playMs - reportedMs) / 1000;
  if (points <= 0 || seconds <= 0) return Promise.resolve();
  reported += points;
  reportedMs = playMs;
  const body = JSON.stringify({ game, points, seconds, token });
  if (beacon && navigator.sendBeacon?.("/api/scores", new Blob([body], { type: "application/json" }))) {
    return Promise.resolve();
  }
  return fetch("/api/scores", { method: "POST", body, headers: { "Content-Type": "application/json" }, keepalive: true })
    .then((r) => {
      if (!r.ok && r.status !== 401) throw new Error(String(r.status));
    })
    .catch(() => {
      // try again with the next flush
      reported -= points;
      reportedMs -= seconds * 1000;
    })
    .finally(emit);
}

export function subscribeSession(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function emit() {
  for (const cb of listeners) cb();
}
