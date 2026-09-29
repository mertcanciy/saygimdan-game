import { GAMES, type GameSlug } from "./games";

/** "all" = overall table (every game's best, scaled to that game's record). */
export type Board = GameSlug | "all";

export interface BoardEntry {
  rank: number;
  name: string;
  score: number;
}

export interface BoardResponse {
  board: Board;
  entries: BoardEntry[];
  /** players on this board */
  total: number;
  /** the signed-in player's row (also when outside `entries`) */
  me: BoardEntry | null;
}

/** Overall table: each game's personal best is worth up to this much (the game's #1 gets it all). */
export const OVERALL_PER_GAME = 1000;

export function isBoard(v: string | null | undefined): v is Board {
  return v === "all" || GAMES.some((g) => g.slug === v);
}

export function boardTitle(board: Board): string {
  return board === "all" ? "Genel" : (GAMES.find((g) => g.slug === board)?.title ?? board);
}

/** Usernames: 3–16 letters/digits (Turkish letters too), `_ . -` and single spaces. */
export const NAME_RE = /^[\p{L}\p{N}_.\- ]{3,16}$/u;

export function cleanName(raw: string): string {
  return raw.normalize("NFC").trim().replace(/\s+/g, " ");
}

/** Case-insensitive identity of a username ("Ada" and "ADA" are the same player). */
export function nameKey(name: string): string {
  return cleanName(name).toLocaleLowerCase("tr");
}

export const PIN_RE = /^\d{4}$/;

const fmt = new Intl.NumberFormat("tr-TR");
export function formatScore(n: number): string {
  return fmt.format(Math.round(n));
}
