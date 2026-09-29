/** Shared by the client and the API: player names, leaderboard shapes, score limits. */
import { GAMES, GameSlug } from "./games";

export const GAME_SLUGS = GAMES.map((g) => g.slug);
export type Board = GameSlug | "all";

export function isGameSlug(v: unknown): v is GameSlug {
  return typeof v === "string" && (GAME_SLUGS as string[]).includes(v);
}

export const NAME_MIN = 2;
export const NAME_MAX = 16;

/** Trimmed, single-spaced name, or an error message (Turkish, shown under the field). */
export function checkName(raw: string): { name: string } | { error: string } {
  const name = raw.normalize("NFC").trim().replace(/\s+/g, " ");
  if (name.length < NAME_MIN) return { error: `Kullanıcı adı en az ${NAME_MIN} karakter olmalı.` };
  if (name.length > NAME_MAX) return { error: `Kullanıcı adı en fazla ${NAME_MAX} karakter olabilir.` };
  if (!/^[\p{L}\p{N}_.\- ]+$/u.test(name)) return { error: "Sadece harf, rakam, boşluk ve _ . - kullanabilirsin." };
  return { name };
}

export const PASSWORD_MIN = 6;
export const PASSWORD_MAX = 128;

export function checkPassword(pw: string): string | null {
  if (pw.length < PASSWORD_MIN) return `Şifre en az ${PASSWORD_MIN} karakter olmalı.`;
  if (pw.length > PASSWORD_MAX) return "Şifre çok uzun.";
  return null;
}

/**
 * Uniqueness key: "Ayşe" and "AYŞE" are the same player name. The four
 * Turkish i's (I ı İ i) count as one letter too, otherwise "TEST_UI" (→ "test_uı")
 * and "test_ui" would be two different players that look alike.
 */
export function nameKey(name: string): string {
  return name.toLocaleLowerCase("tr-TR").replace(/ı/g, "i");
}

/**
 * Most points a player can really earn per second of play (generous: combos,
 * nitro, lap bonuses), plus a burst for a big bonus landing right away. The
 * games run on the client, so this only stops absurd numbers.
 */
export const MAX_POINTS_PER_SEC: Record<GameSlug, number> = {
  spiderman: 1500,
  drift: 1500,
  f16: 1500,
  traffic: 8000,
};
export const POINTS_BURST = 5000;

export interface BoardRow {
  rank: number;
  name: string;
  score: number;
}

export interface BoardResponse {
  board: Board;
  rows: BoardRow[];
  total: number;
  me?: { rank: number | null; score: number };
}
