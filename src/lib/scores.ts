"use client";

import { useEffect, useState } from "react";
import { create } from "zustand";
import { ApiError, fetchBoard, postScore, type ScoreResult } from "./api";
import type { GameSlug } from "./games";
import type { Board, BoardResponse } from "./leaderboard";
import { useUserStore } from "./store";

/*
 * Scores go up during a run (each game's HUD reports its running total);
 * the highest value is sent a few seconds after it stops changing, and right
 * away when the game is paused, left or hidden. The server keeps each
 * player's best, so re-sending a lower score changes nothing.
 */

interface ScoreState {
  /** last answer from the server for a submitted score (drives the "new record" toast) */
  last: (ScoreResult & { game: GameSlug; at: number }) | null;
  /** bumps whenever a submitted score changed a board, so open tables refetch */
  version: number;
}

export const useScoreStore = create<ScoreState>()(() => ({ last: null, version: 0 }));

const pending = new Map<GameSlug, number>();
const sent = new Map<GameSlug, number>();
let timer: ReturnType<typeof setTimeout> | null = null;
let listening = false;

const SETTLE_MS = 4000;

export function reportScore(game: GameSlug, score: number) {
  if (!(score > 0) || !useUserStore.getState().user?.token) return;
  if (score <= Math.max(sent.get(game) ?? 0, pending.get(game) ?? 0)) return;
  pending.set(game, score);
  if (timer) clearTimeout(timer);
  timer = setTimeout(flushScores, SETTLE_MS);
  if (!listening && typeof window !== "undefined") {
    listening = true;
    window.addEventListener("pagehide", flushScores);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flushScores();
    });
  }
}

export function flushScores() {
  if (timer) clearTimeout(timer);
  timer = null;
  const token = useUserStore.getState().user?.token;
  if (!token) return pending.clear();
  for (const [game, score] of pending) {
    pending.delete(game);
    sent.set(game, score);
    postScore(game, score, token).then(
      (res) =>
        useScoreStore.setState((s) => ({
          last: { ...res, game, at: Date.now() },
          version: res.improved ? s.version + 1 : s.version,
        })),
      (e: unknown) => {
        // session no longer valid (e.g. database reset): keep playing as a guest
        if (e instanceof ApiError && e.status === 401) {
          const u = useUserStore.getState().user;
          if (u) useUserStore.getState().setUser({ ...u, token: null });
        } else if (e instanceof ApiError && (e.status === 0 || e.status >= 500)) {
          sent.delete(game);
        }
      }
    );
  }
}

/** For the game components: report the HUD's running score. */
export function useReportScore(game: GameSlug, score: number) {
  useEffect(() => {
    reportScore(game, score);
  }, [game, score]);
}

/* ------------------------------------------------------------------ */

const cache = new Map<string, BoardResponse>();
const REFRESH_MS = 30_000;

export type BoardStatus = "loading" | "ready" | "offline";

/** A leaderboard, refreshed every 30 s and after the player's own new records. */
export function useBoard(board: Board, limit: number): { data: BoardResponse | null; status: BoardStatus } {
  const token = useUserStore((s) => s.user?.token ?? null);
  const version = useScoreStore((s) => s.version);
  const cacheKey = `${board}|${limit}|${token ?? ""}`;
  const [state, setState] = useState<{ key: string; data: BoardResponse | null; status: BoardStatus }>(() => ({
    key: cacheKey,
    data: cache.get(cacheKey) ?? null,
    status: cache.has(cacheKey) ? "ready" : "loading",
  }));

  // switching tables: show the cached one (or a loading state) straight away
  if (state.key !== cacheKey) {
    setState({ key: cacheKey, data: cache.get(cacheKey) ?? null, status: cache.has(cacheKey) ? "ready" : "loading" });
  }

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetchBoard(board, limit, token).then(
        (data) => {
          cache.set(cacheKey, data);
          if (alive) setState({ key: cacheKey, data, status: "ready" });
        },
        () => {
          if (alive) setState((s) => (s.key === cacheKey && s.data ? s : { key: cacheKey, data: null, status: "offline" }));
        }
      );
    void load();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [board, limit, token, cacheKey, version]);

  return { data: state.data, status: state.status };
}
