"use client";

import type { GameSlug } from "./games";
import type { Board, BoardResponse } from "./leaderboard";

export class ApiError extends Error {
  constructor(
    public code: string,
    public status: number
  ) {
    super(code);
  }
}

async function call<T>(url: string, init: RequestInit & { token?: string | null } = {}): Promise<T> {
  const { token, headers, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(url, {
      ...rest,
      headers: {
        ...(rest.body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
    });
  } catch {
    throw new ApiError("network", 0);
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(data.error ?? "unknown", res.status);
  return data;
}

export function checkName(name: string, signal?: AbortSignal) {
  return call<{ available: boolean }>(`/api/auth?name=${encodeURIComponent(name)}`, { signal });
}

export function signIn(name: string, pin: string) {
  return call<{ token: string; name: string; created: boolean }>("/api/auth", {
    method: "POST",
    body: JSON.stringify({ name, pin }),
  });
}

export function fetchBoard(board: Board, limit: number, token: string | null) {
  return call<BoardResponse>(`/api/leaderboard?board=${board}&limit=${limit}`, { token, cache: "no-store" });
}

export interface ScoreResult {
  best: number;
  improved: boolean;
  rank: number | null;
  total: number;
}

export function postScore(game: GameSlug, score: number, token: string) {
  return call<ScoreResult>("/api/scores", {
    method: "POST",
    token,
    body: JSON.stringify({ game, score }),
    // still delivered if the page is closing
    keepalive: true,
  });
}
