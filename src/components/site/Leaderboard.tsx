"use client";

import { Trophy } from "lucide-react";
import { GAMES } from "@/lib/games";
import { formatScore, type Board, type BoardEntry } from "@/lib/leaderboard";
import { useBoard } from "@/lib/scores";
import { useUserStore } from "@/lib/store";
import { cn } from "@/lib/utils";

export const BOARDS: { id: Board; label: string }[] = [
  { id: "all", label: "Genel" },
  ...GAMES.map((g) => ({ id: g.slug as Board, label: g.title })),
];

export function BoardTabs({ value, onChange, className }: { value: Board; onChange: (b: Board) => void; className?: string }) {
  return (
    <div role="tablist" aria-label="Tablo" className={cn("-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none]", className)}>
      {BOARDS.map((b) => (
        <button
          key={b.id}
          type="button"
          role="tab"
          aria-selected={value === b.id}
          onClick={() => onChange(b.id)}
          className={cn(
            "inline-flex h-10 shrink-0 items-center rounded-full px-4 text-[14.5px] font-semibold tracking-[-0.01em] transition-colors",
            value === b.id ? "bg-ink text-paper" : "bg-soft text-muted-ink hover:text-ink"
          )}
        >
          {b.label}
        </button>
      ))}
    </div>
  );
}

const MEDALS = ["#e0a50b", "#9ca3af", "#b4692c"];

function Row({ e, me, compact, index }: { e: BoardEntry; me: boolean; compact?: boolean; index: number }) {
  return (
    <li
      className={cn(
        "animate-row grid grid-cols-[2.25rem_1fr_auto] items-center gap-3 border-b border-line last:border-b-0",
        compact ? "py-2" : "py-3",
        me && "-mx-3 rounded-xl border-transparent bg-red-tint px-3"
      )}
      style={{ animationDelay: `${Math.min(index, 12) * 25}ms` }}
    >
      <span
        className={cn(
          "grid size-8 place-items-center rounded-full text-[14px] font-bold tabular-nums",
          compact && "size-7 text-[13px]",
          e.rank > 3 && "text-muted-ink"
        )}
        style={e.rank <= 3 ? { background: MEDALS[e.rank - 1], color: "#fff" } : undefined}
      >
        {e.rank}
      </span>
      <span className={cn("truncate font-semibold tracking-[-0.01em]", compact ? "text-[15px]" : "text-[17px]")}>
        {e.name}
        {me && <span className="ml-2 text-[12px] font-semibold text-red">sen</span>}
      </span>
      <span className={cn("font-bold tabular-nums tracking-[-0.02em]", compact ? "text-[15px]" : "text-[18px]")}>{formatScore(e.score)}</span>
    </li>
  );
}

/**
 * One leaderboard: top `limit` rows, the player's own row pinned under them
 * when they're further down, refreshed every 30 s.
 */
export function BoardList({
  board,
  limit,
  compact,
  empty = "Henüz skor yok. İlk sen ol!",
  className,
}: {
  board: Board;
  limit: number;
  compact?: boolean;
  empty?: string;
  className?: string;
}) {
  const { data, status } = useBoard(board, limit);
  const guest = useUserStore((s) => !!s.user && !s.user.token);
  const meName = data?.me?.name;

  if (status === "loading" && !data)
    return (
      <ul className={cn("grid", className)} aria-busy>
        {Array.from({ length: Math.min(limit, compact ? 3 : 6) }, (_, i) => (
          <li key={i} className={cn("flex items-center gap-3 border-b border-line last:border-b-0", compact ? "py-2" : "py-3")}>
            <span className="size-7 animate-pulse rounded-full bg-soft" />
            <span className="h-4 flex-1 animate-pulse rounded bg-soft" />
            <span className="h-4 w-14 animate-pulse rounded bg-soft" />
          </li>
        ))}
      </ul>
    );

  if (!data) return <p className={cn("text-[14px] text-muted-ink", className)}>Liderlik tablosuna şu an ulaşılamıyor.</p>;

  const meInTop = !!data.me && data.entries.some((e) => e.rank === data.me!.rank);

  return (
    <div className={className}>
      {data.entries.length === 0 ? (
        <p className="flex items-center gap-2 py-3 text-[15px] text-muted-ink">
          <Trophy aria-hidden className="size-4" />
          {empty}
        </p>
      ) : (
        <ol key={board}>
          {data.entries.map((e, i) => (
            <Row key={`${e.rank}-${e.name}`} e={e} me={!!meName && e.rank === data.me?.rank} compact={compact} index={i} />
          ))}
        </ol>
      )}
      {data.me && !meInTop && (
        <ol className="mt-2 border-t border-dashed border-line pt-2">
          <Row e={data.me} me compact={compact} index={0} />
        </ol>
      )}
      {guest && <p className="mt-3 text-[13px] text-muted-ink">Misafir olarak oynuyorsun, skorların tabloya girmez.</p>}
    </div>
  );
}
