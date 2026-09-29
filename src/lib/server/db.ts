import { promises as fs } from "fs";
import path from "path";
import { GAMES, type GameSlug } from "@/lib/games";
import { OVERALL_PER_GAME, type Board } from "@/lib/leaderboard";

/*
 * Storage for players and leaderboards.
 *
 * Production: Upstash Redis over its REST API (Vercel Marketplace → Upstash
 * sets KV_REST_API_URL / KV_REST_API_TOKEN; UPSTASH_REDIS_REST_* also work).
 *   u:<nameKey>      JSON { name, pinHash, createdAt }   (SET NX: first come, first served)
 *   t:<sha256(tok)>  nameKey                             (session token → player)
 *   lb:<slug>        sorted set nameKey → personal best  (ZADD GT: only ever goes up)
 *   lb:all           ZUNIONSTORE of the four, each weighted 1000 / that game's #1
 *   rl:<...>         INCR + EXPIRE counters (rate limits)
 *
 * Without Redis env (local dev / `next start` off Vercel): the same data in
 * memory, saved to .data/db.json, so the site works on localhost with no setup.
 */

export interface PlayerRecord {
  name: string;
  pinHash: string;
  createdAt: number;
}

export interface Ranked {
  key: string;
  score: number;
}

export interface BoardPage {
  top: Ranked[];
  total: number;
  me: { rank: number; score: number } | null;
}

export interface Db {
  getPlayer(key: string): Promise<PlayerRecord | null>;
  /** false if the name is already taken */
  createPlayer(key: string, rec: PlayerRecord): Promise<boolean>;
  setToken(tokenHash: string, key: string): Promise<void>;
  playerForToken(tokenHash: string): Promise<string | null>;
  /** keeps the higher score; returns the stored best and whether this score raised it */
  submit(game: GameSlug, key: string, score: number): Promise<{ best: number; improved: boolean }>;
  board(board: Board, limit: number, me: string | null): Promise<BoardPage>;
  names(keys: string[]): Promise<Map<string, string>>;
  /** increments a counter that expires `windowSec` after its first hit; returns the new count */
  hit(key: string, windowSec: number): Promise<number>;
}

export class DbUnavailableError extends Error {}

/* ------------------------------------------------------------------ */

type RedisValue = string | number | null | RedisValue[];

class RedisDb implements Db {
  constructor(
    private url: string,
    private token: string
  ) {}

  private async pipeline(cmds: (string | number)[][]): Promise<RedisValue[]> {
    const res = await fetch(`${this.url}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(cmds),
      cache: "no-store",
    });
    if (!res.ok) throw new DbUnavailableError(`redis ${res.status}`);
    const out = (await res.json()) as { result?: RedisValue; error?: string }[];
    return out.map((r) => {
      if (r.error) throw new DbUnavailableError(r.error);
      return r.result ?? null;
    });
  }

  private async cmd(...args: (string | number)[]): Promise<RedisValue> {
    return (await this.pipeline([args]))[0];
  }

  async getPlayer(key: string) {
    const v = await this.cmd("GET", `u:${key}`);
    return typeof v === "string" ? (JSON.parse(v) as PlayerRecord) : null;
  }

  async createPlayer(key: string, rec: PlayerRecord) {
    return (await this.cmd("SET", `u:${key}`, JSON.stringify(rec), "NX")) === "OK";
  }

  async setToken(tokenHash: string, key: string) {
    await this.cmd("SET", `t:${tokenHash}`, key);
  }

  async playerForToken(tokenHash: string) {
    const v = await this.cmd("GET", `t:${tokenHash}`);
    return typeof v === "string" ? v : null;
  }

  async submit(game: GameSlug, key: string, score: number) {
    const [changed, best] = await this.pipeline([
      ["ZADD", `lb:${game}`, "GT", "CH", score, key],
      ["ZSCORE", `lb:${game}`, key],
    ]);
    return { best: Number(best ?? score), improved: Number(changed) > 0 };
  }

  async board(board: Board, limit: number, me: string | null): Promise<BoardPage> {
    let zkey = `lb:${board}`;
    if (board === "all") {
      const tops = await this.pipeline(GAMES.map((g) => ["ZREVRANGE", `lb:${g.slug}`, 0, 0, "WITHSCORES"]));
      const keys: string[] = [];
      const weights: number[] = [];
      GAMES.forEach((g, i) => {
        const top = tops[i] as string[] | null;
        const max = top && top.length === 2 ? Number(top[1]) : 0;
        if (max > 0) {
          keys.push(`lb:${g.slug}`);
          weights.push(OVERALL_PER_GAME / max);
        }
      });
      if (keys.length === 0) return { top: [], total: 0, me: null };
      await this.cmd("ZUNIONSTORE", "lb:all", keys.length, ...keys, "WEIGHTS", ...weights);
      zkey = "lb:all";
    }
    const cmds: (string | number)[][] = [
      ["ZREVRANGE", zkey, 0, limit - 1, "WITHSCORES"],
      ["ZCARD", zkey],
    ];
    if (me) cmds.push(["ZREVRANK", zkey, me], ["ZSCORE", zkey, me]);
    const [range, card, rank, score] = await this.pipeline(cmds);
    const flat = (range as string[] | null) ?? [];
    const top: Ranked[] = [];
    for (let i = 0; i < flat.length; i += 2) top.push({ key: flat[i], score: Number(flat[i + 1]) });
    return {
      top,
      total: Number(card ?? 0),
      me: me && rank !== null && rank !== undefined && score !== null ? { rank: Number(rank) + 1, score: Number(score) } : null,
    };
  }

  async names(keys: string[]) {
    const out = new Map<string, string>();
    if (keys.length === 0) return out;
    const vals = (await this.cmd("MGET", ...keys.map((k) => `u:${k}`))) as (string | null)[];
    keys.forEach((k, i) => {
      const v = vals[i];
      out.set(k, v ? (JSON.parse(v) as PlayerRecord).name : k);
    });
    return out;
  }

  async hit(key: string, windowSec: number) {
    const [n] = await this.pipeline([
      ["INCR", `rl:${key}`],
      ["EXPIRE", `rl:${key}`, windowSec, "NX"],
    ]);
    return Number(n);
  }
}

/* ------------------------------------------------------------------ */

interface FileData {
  players: Record<string, PlayerRecord>;
  tokens: Record<string, string>;
  scores: Partial<Record<GameSlug, Record<string, number>>>;
}

class FileDb implements Db {
  private data: FileData | null = null;
  private counters = new Map<string, { n: number; until: number }>();
  private file = path.join(process.cwd(), ".data", "db.json");
  private saving: Promise<void> = Promise.resolve();

  private async load(): Promise<FileData> {
    if (this.data) return this.data;
    try {
      this.data = JSON.parse(await fs.readFile(this.file, "utf8")) as FileData;
    } catch {
      this.data = { players: {}, tokens: {}, scores: {} };
    }
    return this.data;
  }

  private save() {
    const snapshot = JSON.stringify(this.data, null, 1);
    this.saving = this.saving.then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      await fs.writeFile(this.file, snapshot);
    });
    return this.saving;
  }

  async getPlayer(key: string) {
    return (await this.load()).players[key] ?? null;
  }

  async createPlayer(key: string, rec: PlayerRecord) {
    const d = await this.load();
    if (d.players[key]) return false;
    d.players[key] = rec;
    await this.save();
    return true;
  }

  async setToken(tokenHash: string, key: string) {
    (await this.load()).tokens[tokenHash] = key;
    await this.save();
  }

  async playerForToken(tokenHash: string) {
    return (await this.load()).tokens[tokenHash] ?? null;
  }

  async submit(game: GameSlug, key: string, score: number) {
    const d = await this.load();
    const table = (d.scores[game] ??= {});
    const improved = !(table[key] >= score);
    if (improved) {
      table[key] = score;
      await this.save();
    }
    return { best: table[key], improved };
  }

  async board(board: Board, limit: number, me: string | null): Promise<BoardPage> {
    const d = await this.load();
    let table: Record<string, number>;
    if (board === "all") {
      table = {};
      for (const g of GAMES) {
        const t = d.scores[g.slug] ?? {};
        const max = Math.max(0, ...Object.values(t));
        if (max <= 0) continue;
        for (const [k, v] of Object.entries(t)) table[k] = (table[k] ?? 0) + (v * OVERALL_PER_GAME) / max;
      }
    } else {
      table = d.scores[board] ?? {};
    }
    // same order as Redis ZREVRANGE: score desc, then member desc
    const sorted = Object.entries(table)
      .map(([key, score]) => ({ key, score }))
      .sort((a, b) => b.score - a.score || (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
    const idx = me ? sorted.findIndex((r) => r.key === me) : -1;
    return {
      top: sorted.slice(0, limit),
      total: sorted.length,
      me: idx >= 0 ? { rank: idx + 1, score: sorted[idx].score } : null,
    };
  }

  async names(keys: string[]) {
    const d = await this.load();
    return new Map(keys.map((k) => [k, d.players[k]?.name ?? k]));
  }

  async hit(key: string, windowSec: number) {
    const now = Date.now();
    const c = this.counters.get(key);
    if (!c || c.until < now) {
      this.counters.set(key, { n: 1, until: now + windowSec * 1000 });
      return 1;
    }
    return ++c.n;
  }
}

/* ------------------------------------------------------------------ */

let instance: Db | null = null;

export function getDb(): Db {
  if (instance) return instance;
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) instance = new RedisDb(url.replace(/\/$/, ""), token);
  // on Vercel the filesystem is read-only and per-instance: a real database is required there
  else if (process.env.VERCEL) throw new DbUnavailableError("KV_REST_API_URL / KV_REST_API_TOKEN not set");
  else instance = new FileDb();
  return instance;
}
