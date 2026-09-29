"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Crown } from "lucide-react";
import { api } from "@/lib/api";
import { GAMES, getGame } from "@/lib/games";
import { Board, BoardResponse, BoardRow } from "@/lib/scores";
import { useUserStore } from "@/lib/store";

/*
 * Boards are cached per (board, limit, player) in memory: switching tabs is
 * instant, the fetch refreshes in the background. `refreshBoards()` after
 * points were added (leaving a game) so every board on screen catches up.
 */
type Entry = { data?: BoardResponse; error?: boolean; at: number; loading?: Promise<void> };
const cache = new Map<string, Entry>();
const listeners = new Set<() => void>();
let version = 0;
const STALE_MS = 15_000;

function emit() {
  version++;
  for (const cb of listeners) cb();
}

function load(board: Board, limit: number, key: string, force = false) {
  const e = cache.get(key);
  if (e?.loading || (!force && e && Date.now() - e.at < STALE_MS)) return;
  const entry: Entry = { data: e?.data, at: e?.at ?? 0 };
  entry.loading = api
    .board(board, limit)
    .then((data) => {
      entry.data = data;
      entry.error = false;
    })
    .catch(() => {
      entry.error = true;
    })
    .finally(() => {
      entry.at = Date.now();
      entry.loading = undefined;
      emit();
    });
  cache.set(key, entry);
}

export function refreshBoards() {
  for (const e of cache.values()) e.at = 0;
  emit();
}

export function useBoard(board: Board, limit: number) {
  const player = useUserStore((s) => s.user?.id ?? "");
  const key = `${board}|${limit}|${player}`;
  const v = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => version,
    () => 0
  );
  useEffect(() => {
    load(board, limit, key);
    // live-ish: refresh while the board is on screen
    const t = setInterval(() => {
      if (document.visibilityState === "visible") load(board, limit, key, true);
    }, 30_000);
    return () => clearInterval(t);
  }, [board, limit, key, v]);
  const e = cache.get(key);
  return { data: e?.data, error: !!e?.error && !e.data };
}

const fmt = (n: number) => Math.round(n).toLocaleString("tr-TR");

/* ------------------------------------------------------------------ */

export const BOARD_TABS: { board: Board; label: string }[] = [
  { board: "all", label: "Genel" },
  ...GAMES.map((g) => ({ board: g.slug as Board, label: g.title })),
];

export function BoardTabs({ value, onChange }: { value: Board; onChange: (b: Board) => void }) {
  return (
    <div role="tablist" aria-label="Tablo" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
      {BOARD_TABS.map((t) => {
        const on = t.board === value;
        return (
          <button
            key={t.board}
            role="tab"
            type="button"
            aria-selected={on}
            onClick={() => onChange(t.board)}
            className={`h-10 shrink-0 rounded-full px-4 text-[15px] font-semibold tracking-[-0.01em] transition-colors ${
              on ? "bg-ink text-paper" : "bg-soft text-muted-ink hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/** The ranked list. `limit` rows; the player's own row is pinned below if they're further down. */
export function BoardList({
  board,
  limit,
  dense = false,
  empty,
}: {
  board: Board;
  limit: number;
  dense?: boolean;
  empty?: React.ReactNode;
}) {
  const { data, error } = useBoard(board, limit);
  const me = useUserStore((s) => s.user);
  const accent = board === "all" ? "var(--red)" : getGame(board)?.accent;

  if (error)
    return <p className={`${dense ? "py-3 text-[13px]" : "py-8 text-[15px]"} text-muted-ink`}>Tablo şu an yüklenemedi.</p>;

  if (!data)
    return (
      <ol aria-busy className="grid">
        {Array.from({ length: Math.min(limit, dense ? 5 : 8) }, (_, i) => (
          <li key={i} className={`flex items-center gap-3 border-b border-line ${dense ? "h-9" : "h-14"}`}>
            <span className="h-3 w-5 animate-pulse rounded bg-soft" />
            <span className="h-3 animate-pulse rounded bg-soft" style={{ width: `${40 - i * 3}%` }} />
            <span className="ml-auto h-3 w-14 animate-pulse rounded bg-soft" />
          </li>
        ))}
      </ol>
    );

  if (!data.rows.length)
    return (
      <div className={`${dense ? "py-3 text-[13.5px]" : "py-10 text-[16px]"} text-muted-ink`}>
        {empty ?? "Henüz kimse puan almadı. İlk sen ol."}
      </div>
    );

  const isMine = (r: BoardRow) => !!me && r.name === me.name;
  const mineInTop = data.rows.some(isMine);
  const myRow: BoardRow | null =
    me && !mineInTop && data.me?.rank ? { rank: data.me.rank, name: me.name, score: data.me.score } : null;
  // full boards: the top 3 stand on a podium, the list starts at 4th
  const podium = dense ? [] : data.rows.slice(0, 3);
  const rest = dense ? data.rows : data.rows.slice(3);

  return (
    <div>
      {podium.length > 0 && <Podium rows={podium} isMine={isMine} accent={accent} />}
      <ol className="grid">
        {rest.map((r, i) => (
          <Row key={`${r.name}-${i}`} row={r} mine={isMine(r)} dense={dense} accent={accent} index={i} />
        ))}
        {myRow && (
          <>
            <li aria-hidden className={`text-center text-muted-ink ${dense ? "text-[11px] leading-4" : "py-1 text-[13px]"}`}>
              ···
            </li>
            <Row row={myRow} mine dense={dense} accent={accent} index={0} />
          </>
        )}
      </ol>
    </div>
  );
}

/** 2nd · 1st · 3rd on steps of different height (1st in the middle, tallest). */
// in DOM order (1st, 2nd, 3rd: what a screen reader reads); `order` puts 1st in the middle
const STEPS = [
  { at: 0, order: 1, h: "h-28 narrow:h-24", delay: 0 },
  { at: 1, order: 0, h: "h-20 narrow:h-16", delay: 80 },
  { at: 2, order: 2, h: "h-14 narrow:h-11", delay: 160 },
];

function Podium({ rows, isMine, accent }: { rows: BoardRow[]; isMine: (r: BoardRow) => boolean; accent?: string }) {
  return (
    <ol aria-label="İlk üç" className="mb-4 grid grid-cols-3 items-end gap-3 narrow:gap-2">
      {STEPS.map(({ at, order, h, delay }) => {
        const r = rows[at];
        const first = at === 0;
        const mine = !!r && isMine(r);
        return (
          <li
            key={at}
            style={{ order, animationDelay: `${delay}ms` }}
            className="flex min-w-0 animate-fade-up flex-col items-center text-center"
          >
            {r ? (
              <>
                {first && <Crown aria-hidden className="mb-1 size-6" style={{ color: accent }} />}
                <span
                  aria-hidden
                  className={`grid place-items-center rounded-full font-display font-black leading-none [font-stretch:75%] ${
                    first ? "size-16 text-[28px] narrow:size-14 narrow:text-[24px]" : "size-12 text-[21px] narrow:size-11 narrow:text-[19px]"
                  } ${mine ? "bg-red text-paper" : first ? "text-paper" : "bg-soft text-ink"}`}
                  style={first && !mine ? { background: accent } : undefined}
                >
                  {initial(r.name)}
                </span>
                <span className={`mt-2 w-full truncate px-1 font-semibold tracking-[-0.01em] ${first ? "text-[17px]" : "text-[15px]"} ${mine ? "text-red" : "text-ink"} narrow:text-[14px]`}>
                  {r.name}
                </span>
                <span className="text-[14px] font-semibold text-muted-ink narrow:text-[13px]">{fmt(r.score)}</span>
              </>
            ) : (
              <span className="mb-2 text-[13px] text-muted-ink">—</span>
            )}
            <span
              className={`mt-2 grid w-full place-items-start justify-center rounded-t-2xl pt-2 font-display text-[26px] font-black leading-none [font-stretch:70%] ${h} ${
                mine ? "bg-red-tint text-red" : "bg-soft text-muted-ink"
              }`}
              style={first && !mine && r ? { color: accent } : undefined}
            >
              <span className="sr-only">Sıra </span>
              {r?.rank ?? at + 1}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** First letter for the podium badge (Turkish upper case: i → İ). */
const initial = (name: string) => Array.from(name.trim())[0]?.toLocaleUpperCase("tr-TR") ?? "?";

function Row({ row, mine, dense, accent, index }: { row: BoardRow; mine: boolean; dense: boolean; accent?: string; index: number }) {
  const top = row.rank <= 3;
  return (
    <li
      className={`grid animate-fade-up grid-cols-[2.25rem_1fr_auto] items-center gap-2 border-b border-line ${
        dense ? "h-9 text-[14px] grid-cols-[1.75rem_1fr_auto]" : "h-14 text-[17px] narrow:h-12 narrow:text-[16px]"
      } ${mine ? "-mx-2 rounded-xl border-transparent bg-red-tint px-2" : ""}`}
      style={{ animationDelay: `${Math.min(index, 10) * 25}ms` }}
    >
      <span
        className={`font-bold tabular-nums ${dense ? "text-[13px]" : "text-[15px]"} ${top ? "" : "text-muted-ink"}`}
        style={top ? { color: accent } : undefined}
      >
        {row.rank === 1 ? <Crown aria-label="1" className={dense ? "size-3.5" : "size-4"} /> : row.rank}
      </span>
      <span className="truncate font-semibold tracking-[-0.01em]">{row.name}</span>
      <span className="font-semibold">{fmt(row.score)}</span>
    </li>
  );
}

/** The player's rank on a board, one line ("#12 · 4.520 puan"). */
export function MyRank({ board }: { board: Board }) {
  const { data } = useBoard(board, 5);
  const me = useUserStore((s) => s.user);
  if (!me || !data?.me) return null;
  return (
    <span className="tabular-nums">
      {data.me.rank ? `#${data.me.rank} · ${fmt(data.me.score)} puan` : "Henüz puanın yok"}
    </span>
  );
}

/** Full board with tabs (landing section and /liderlik). */
export function LeaderboardPanel({ initial = "all", limit = 50 }: { initial?: Board; limit?: number }) {
  const [board, setBoard] = useState<Board>(initial);
  // warm the other tabs so switching is instant
  useEffect(() => {
    const t = setTimeout(() => BOARD_TABS.forEach((b) => b.board !== board && prefetchBoard(b.board, limit)), 600);
    return () => clearTimeout(t);
  }, [board, limit]);
  const game = board === "all" ? null : getGame(board);
  return (
    <div>
      <BoardTabs value={board} onChange={setBoard} />
      <p className="mt-4 min-h-[1.5em] text-[15px] text-muted-ink">
        {game ? `${game.title}: oyunda kazandığın tüm puanların toplamı.` : "Dört oyunda kazanılan puanların toplamı."}{" "}
        {game && (
          <Link href={`/play/${game.slug}`} className="font-medium text-ink underline underline-offset-4">
            Oyna
          </Link>
        )}
      </p>
      <div className="mt-4">
        <BoardList key={board} board={board} limit={limit} />
      </div>
    </div>
  );
}

function prefetchBoard(board: Board, limit: number) {
  const player = useUserStore.getState().user?.id ?? "";
  load(board, limit, `${board}|${limit}|${player}`);
}
