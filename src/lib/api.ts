"use client";

import { Board, BoardResponse } from "./scores";
import { useUserStore, User } from "./store";

type Player = Omit<User, "token">;
export type SignInResult = { player: Player; token: string } | { needsName: true; suggestion: string };

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const token = useUserStore.getState().user?.token;
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data?.error ?? "Bir şeyler ters gitti, tekrar dene.", data?.field);
  return data as T;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** which form field the error is about ("name" / "password") */
    public field?: string
  ) {
    super(message);
  }
}

const post = <T>(path: string, body: unknown) => call<T>(path, { method: "POST", body: JSON.stringify(body) });

export const api = {
  /** is the name taken, and does its owner use a password or Google / mail? */
  nameStatus: (name: string, signal?: AbortSignal) =>
    call<{ exists: boolean; via?: User["via"] }>(`/api/users?name=${encodeURIComponent(name)}`, { signal }),
  register: (name: string, password: string) => post<{ player: Player; token: string }>("/api/users", { name, password }),
  login: (name: string, password: string) => post<{ player: Player; token: string }>("/api/login", { name, password }),
  /** name for a new Google / mail account */
  createPlayer: (name: string, idToken: string) => post<{ player: Player; token: string }>("/api/users", { name, idToken }),
  firebase: (idToken: string) => post<SignInResult>("/api/auth/firebase", { idToken }),
  /** hands this device's sign-in to the tab/app that asked for the mail link */
  handoffPut: (nonce: string) => post<{ ok: true }>("/api/auth/handoff", { nonce }),
  handoffTake: (nonce: string) =>
    call<{ player: Player; token: string } | { pending: true }>(`/api/auth/handoff?n=${encodeURIComponent(nonce)}`),
  me: () => call<{ player: Player }>("/api/me"),
  board: (board: Board, limit: number) => call<BoardResponse>(`/api/leaderboard?game=${board}&limit=${limit}`),
};

/** Stores a signed-in player on this device. */
export function signedIn(r: { player: Player; token: string }) {
  useUserStore.getState().setUser({ ...r.player, token: r.token });
}
