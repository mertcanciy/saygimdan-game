"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { getGame } from "@/lib/games";
import { OVERALL_PER_GAME, formatScore, isBoard, type Board } from "@/lib/leaderboard";
import { useBoard } from "@/lib/scores";
import { useAuthDialog, useHydrated, useUserStore } from "@/lib/store";
import { Pill, SiteNav } from "@/components/site/Chrome";
import { BoardList, BoardTabs } from "@/components/site/Leaderboard";

export default function LeaderboardView() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const q = params.get("oyun");
  const board: Board = isBoard(q) ? q : "all";
  const game = board === "all" ? null : getGame(board);

  const setBoard = (b: Board) => router.replace(b === "all" ? pathname : `${pathname}?oyun=${b}`, { scroll: false });

  return (
    <>
      <SiteNav />
      <main className="mx-auto max-w-[880px] px-5 pb-40 pt-14 sm:px-10 sm:pt-20 narrow:pb-32 narrow:pt-10">
        <p className="text-[15px] font-semibold text-red">Liderlik Tablosu</p>
        <h1 className="display-2 mt-2 text-[clamp(2.6rem,6vw,4.6rem)] narrow:text-[2.5rem]">{game ? game.title : "Genel sıralama"}</h1>
        <p className="mt-4 max-w-[34rem] text-[16px] leading-[1.55] text-muted-ink">
          {game
            ? `${game.title} oyununda herkesin en iyi skoru. ${game.goal}`
            : `Her oyunun rekoru ${formatScore(OVERALL_PER_GAME)} puan; en iyi skorun rekora ne kadar yakınsa o oyundan o kadar puan alırsın. Dört oyunun toplamı.`}
        </p>

        <BoardTabs value={board} onChange={setBoard} className="mt-8" />
        <Podium board={board} />
        <BoardList board={board} limit={50} className="mt-6" />
        <Cta board={board} />
      </main>
    </>
  );
}

const PODIUM_ORDER = [1, 0, 2];
const PODIUM_H = ["h-28", "h-20", "h-16"];
const MEDALS = ["#e0a50b", "#9ca3af", "#b4692c"];

function Podium({ board }: { board: Board }) {
  const { data } = useBoard(board, 50);
  const top = data?.entries.slice(0, 3) ?? [];
  if (top.length < 3) return null;
  return (
    <div key={board} className="mt-10 grid grid-cols-3 items-end gap-3 narrow:gap-2">
      {PODIUM_ORDER.map((i) => (
        <div key={i} className="min-w-0 text-center animate-row" style={{ animationDelay: `${i * 80}ms` }}>
          <p className="truncate text-[17px] font-bold tracking-[-0.02em] narrow:text-[15px]">{top[i].name}</p>
          <p className="text-[14px] tabular-nums text-muted-ink">{formatScore(top[i].score)}</p>
          <div
            className={`mt-2 grid place-items-start justify-center rounded-t-2xl pt-3 text-[26px] font-black text-white ${PODIUM_H[i]}`}
            style={{ background: MEDALS[i] }}
          >
            {i + 1}
          </div>
        </div>
      ))}
    </div>
  );
}

function Cta({ board }: { board: Board }) {
  const hydrated = useHydrated();
  const user = useUserStore((s) => s.user);
  const show = useAuthDialog((s) => s.show);
  if (!hydrated) return null;
  const href = board === "all" ? "/games" : `/play/${board}`;
  return (
    <div className="mt-12 flex flex-wrap items-center gap-4">
      {user ? (
        <Pill play href={href}>
          {board === "all" ? "Oyunlara git" : "Oyna"}
        </Pill>
      ) : (
        <>
          <Pill play onClick={() => show({ next: href })}>
            Sen de gir
          </Pill>
          <span className="text-[14px] text-muted-ink">Kullanıcı adı + PIN, e-posta yok.</span>
        </>
      )}
    </div>
  );
}
