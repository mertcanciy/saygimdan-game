"use client";

import { useSyncExternalStore } from "react";
import { SiteNav, Pill } from "@/components/site/Chrome";
import { NavAccount, NavLeaderboard } from "@/components/site/Account";
import { LeaderboardPanel } from "@/components/site/Leaderboard";
import { isGameSlug } from "@/lib/scores";
import { useHydrated, useLoginDialog, useMusicStore, useUserStore } from "@/lib/store";

const noop = () => () => {};
/** ?oyun=drift opens that game's tab (links from a game's start screen). */
const initialBoard = () => {
  const g = new URLSearchParams(window.location.search).get("oyun");
  return isGameSlug(g) ? g : "all";
};

export default function LeaderboardPage() {
  const board = useSyncExternalStore(noop, initialBoard, () => null);
  const hydrated = useHydrated();
  const user = useUserStore((s) => s.user);
  const showLogin = useLoginDialog((s) => s.show);
  const startMusic = useMusicStore((s) => s.start);

  return (
    <>
      <SiteNav>
        <NavLeaderboard />
        <NavAccount />
      </SiteNav>
      <main className="mx-auto max-w-[860px] px-5 pb-40 pt-16 sm:px-10 sm:pt-24 narrow:pb-32 narrow:pt-10">
        <h1 className="display-2 text-[clamp(2.8rem,6vw,5rem)]">Liderlik tablosu.</h1>
        <p className="mt-5 max-w-[34rem] text-[17px] leading-[1.55] text-muted-ink narrow:text-[16px]">
          Her oyundan çıktığında o turda kazandığın puan hanene eklenir. Genel tablo dört oyunun toplamı.
        </p>
        {hydrated && !user && (
          <div className="mt-8">
            <Pill
              play
              onClick={() => {
                startMusic();
                showLogin("/games");
              }}
            >
              Oyna, tabloya gir
            </Pill>
          </div>
        )}
        <div className="mt-12 narrow:mt-9">{board && <LeaderboardPanel initial={board} limit={100} />}</div>
      </main>
    </>
  );
}
