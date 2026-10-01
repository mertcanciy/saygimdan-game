"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { GAMES } from "@/lib/games";
import { MUSIC } from "@/lib/music";
import { useHydrated, useLoginDialog, useMusicStore, useUserStore } from "@/lib/store";
import { Keys, Pill, SiteNav, Wordmark } from "@/components/site/Chrome";
import GameShot from "@/components/site/GameShot";
import FlutedBackdrop from "@/components/site/FlutedBackdrop";
import RecordVinyl from "@/components/site/RecordVinyl";
import { NavAccount, NavLeaderboard } from "@/components/site/Account";
import { LeaderboardPanel } from "@/components/site/Leaderboard";

export default function Landing() {
  const router = useRouter();
  const hydrated = useHydrated();
  const user = useUserStore((s) => s.user);
  const startMusic = useMusicStore((s) => s.start);
  const showLogin = useLoginDialog((s) => s.show);
  const loggedIn = hydrated && !!user;

  const play = () => {
    // signed out, the sign-in sheet would cover the player: the song waits for the game
    if (!loggedIn) return showLogin("/games");
    // synchronously, inside the tap: phones only start sound there
    startMusic();
    router.push("/games");
  };

  return (
    <>
      <SiteNav>
        <a href="#oyunlar" className="hidden sm:inline hover:text-ink transition-colors">
          Oyunlar
        </a>
        <NavLeaderboard />
        <NavAccount className="hidden sm:block" />
        <Pill small play onClick={play}>
          {loggedIn ? "Oyunlara git" : "Oyna"}
        </Pill>
      </SiteNav>

      <main>
        <Hero onPlay={play} loggedIn={loggedIn} />
        <GamesPinned loggedIn={loggedIn} />
        <LeaderboardSection />
      </main>

      <Footer />
    </>
  );
}

/* ------------------------------------------------------------------ */

/** Record-sleeve hero: the song is the point, the games are its tracks. */
const SIDES = ["A1", "A2", "B1", "B2"];

function Hero({ onPlay, loggedIn }: { onPlay: () => void; loggedIn: boolean }) {
  const playing = useMusicStore((s) => s.playing);
  const [track, setTrack] = useState(0);
  const gameLink = useGameLink(loggedIn);

  return (
    <section className="relative isolate overflow-hidden">
      {/* reeded glass over a soft red glow (full bleed behind the content) */}
      <FlutedBackdrop className="-z-10" />
      <div className="mx-auto grid min-h-[calc(100svh-var(--nav-h))] max-w-[1280px] items-center gap-x-14 gap-y-12 px-5 pb-20 pt-10 sm:px-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:pb-16 narrow:gap-y-10 narrow:px-4 narrow:pt-8 short:min-h-0">
      <div className="min-w-0">
        <p className="text-[17px] font-semibold narrow:text-[15px]">Bengü&apos;nün şarkısı, dört oyun, tek şehir</p>
        <h1 className="display mt-3 whitespace-nowrap text-[clamp(5.6rem,15.5vw,13.5rem)] lg:text-[clamp(5.6rem,11.4vw,11.2rem)] narrow:text-[23vw]">
          Saygımdan
        </h1>
        <p className="mt-7 max-w-[31rem] text-[clamp(1.05rem,1.45vw,1.25rem)] leading-[1.5] text-muted-ink narrow:mt-5 narrow:text-[16px]">
          Şarkı döngüde çalarken gökdelenlerin arasında ağ at, gece meydanında drift yap, F-16 ile çatıları sıyır.
          Kurulum yok, tarayıcında açılır.
        </p>
        <div className="mt-9 flex flex-wrap items-center gap-3 narrow:mt-7">
          <Pill play onClick={onPlay}>
            Oynamaya başla
          </Pill>
          <a href="#oyunlar" className="ghost">
            Oyunlara bak
          </a>
        </div>
      </div>

      <div className="min-w-0">
        <figure className="record mx-auto max-w-[34rem] lg:mx-0">
          <RecordVinyl playing={playing} />
          <div className="record-sleeve">
            {GAMES.map((g, i) => (
              <div
                key={g.slug}
                className="absolute inset-0 transition-opacity duration-300"
                style={{ opacity: i === track ? 1 : 0 }}
              >
                <GameShot slug={g.slug} alt={i === track ? `${g.title} oyunundan bir kare` : ""} priority={i === 0} />
              </div>
            ))}
            {/* printed on the sleeve, like a single's cover */}
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-5 pb-4 pt-16 text-paper">
              <div className="font-display text-[clamp(1.9rem,3.4vw,2.6rem)] font-black leading-[0.9] [font-stretch:62%]">
                Saygımdan
              </div>
              <div className="mt-1 text-[14px] font-medium text-white/80">Bengü</div>
            </div>
          </div>
          <figcaption className="sr-only">Plak kılıfı: seçili oyunun görüntüsü</figcaption>
        </figure>

        {/* the games as the record's tracklist; pointing at one swaps the sleeve art */}
        <ol className="mx-auto mt-6 grid max-w-[34rem] grid-flow-col grid-cols-2 grid-rows-2 gap-x-6 lg:mx-0">
          {GAMES.map((g, i) => (
            <li key={g.slug}>
              <Link
                {...gameLink(g.slug)}
                onMouseEnter={() => setTrack(i)}
                onFocus={() => setTrack(i)}
                className={`flex items-baseline gap-3 border-t py-2.5 transition-colors ${
                  i === track ? "border-ink text-ink" : "border-line text-muted-ink hover:text-ink"
                }`}
              >
                <span className={`w-6 shrink-0 text-[13px] font-bold tabular-nums ${i === track ? "text-red" : ""}`}>
                  {SIDES[i]}
                </span>
                <span className="text-[17px] font-semibold tracking-[-0.01em]">{g.title}</span>
              </Link>
            </li>
          ))}
        </ol>
      </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

/** Pinned section: scroll moves through the four games, the stage swaps screenshots. */
function GamesPinned({ loggedIn }: { loggedIn: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const [progress, setProgress] = useState(0);
  const active = Math.min(GAMES.length - 1, Math.floor(progress * GAMES.length));

  useEffect(() => {
    const onScroll = () => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const total = r.height - window.innerHeight;
      setProgress(Math.max(0, Math.min(0.9999, -r.top / Math.max(1, total))));
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  const jumpTo = (i: number) => {
    const el = ref.current;
    if (!el) return;
    const total = el.offsetHeight - window.innerHeight;
    window.scrollTo({ top: el.offsetTop + ((i + 0.5) / GAMES.length) * total, behavior: "smooth" });
  };

  const game = GAMES[active];
  const gameLink = useGameLink(loggedIn);

  return (
    <section id="oyunlar" ref={ref} className="relative border-t border-line lg:h-[360vh]">
      <div className="lg:sticky lg:top-[var(--nav-h)] lg:h-[calc(100svh-var(--nav-h))]">
        <div className="mx-auto grid h-full max-w-[1280px] items-center gap-10 px-5 py-16 sm:px-10 lg:grid-cols-[0.8fr_1.35fr] lg:gap-16 lg:py-10 narrow:gap-8 narrow:py-12">
          {/* list */}
          <div>
            <h2 className="display-2 text-[clamp(2.4rem,4.6vw,4.2rem)]">Dört oyun, tek şarkı.</h2>
            <p className="mt-4 max-w-[26rem] text-[17px] leading-[1.55] text-muted-ink narrow:text-[16px]">
              Hepsi aynı şehirde geçiyor. Şarkı sen oyun değiştirirken de çalmaya devam eder.
            </p>

            <ol className="relative mt-10 hidden border-l border-line lg:block">
              <span
                aria-hidden
                className="absolute -left-px top-0 w-[2px] origin-top bg-ink"
                style={{ height: "100%", transform: `scaleY(${progress})` }}
              />
              {GAMES.map((g, i) => (
                <li key={g.slug}>
                  <button
                    type="button"
                    onClick={() => jumpTo(i)}
                    className={`block w-full py-3 pl-6 text-left transition-colors ${
                      i === active ? "text-ink" : "text-[#b4b4b2] hover:text-muted-ink"
                    }`}
                  >
                    <span className="block text-[26px] font-bold tracking-[-0.035em]">{g.title}</span>
                    <span className="block text-[15px]">{g.subtitle}</span>
                  </button>
                </li>
              ))}
            </ol>
          </div>

          {/* stage (desktop) */}
          <div className="hidden lg:block">
            <Link
              {...gameLink(game.slug)}
              className="group relative block aspect-[16/10] overflow-hidden rounded-[24px] bg-soft"
              aria-label={`${game.title} oyununu aç`}
            >
              {GAMES.map((g, i) => (
                <div
                  key={g.slug}
                  className="absolute inset-0 transition-opacity duration-500"
                  style={{ opacity: i === active ? 1 : 0 }}
                >
                  <GameShot slug={g.slug} alt={`${g.title} oyunundan bir kare`} priority={i === 0} />
                </div>
              ))}
              <div className="absolute inset-x-4 bottom-4 flex items-end justify-between gap-4">
                <div className="max-w-[30rem] rounded-2xl bg-paper/95 p-4 backdrop-blur">
                  <p className="text-[15px] leading-[1.45] text-ink">{game.description}</p>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-[13px] text-muted-ink">
                    {game.controls.slice(0, 3).map((c) => (
                      <span key={c.label} className="inline-flex items-center gap-1.5">
                        <Keys keys={c.keys} />
                        {c.label}
                      </span>
                    ))}
                  </div>
                </div>
                <span className="pill pill-sm pointer-events-none shrink-0">
                  <PlayGlyph />
                  <span>Oyna</span>
                </span>
              </div>
            </Link>
            <p className="mt-3 text-right text-[13px] tabular-nums text-muted-ink">
              {active + 1} / {GAMES.length}
            </p>
          </div>

          {/* stacked list (mobile / tablet) */}
          <ul className="grid gap-10 sm:grid-cols-2 sm:gap-x-6 lg:hidden narrow:gap-9">
            {GAMES.map((g) => (
              <li key={g.slug}>
                <Link {...gameLink(g.slug)} className="block">
                  <div className="aspect-[16/10] overflow-hidden rounded-[18px] bg-soft">
                    <GameShot slug={g.slug} alt={`${g.title} oyunundan bir kare`} />
                  </div>
                  <h3 className="mt-4 text-[28px] font-bold tracking-[-0.035em] narrow:mt-3 narrow:text-[24px]">{g.title}</h3>
                  <p className="mt-1 text-[16px] leading-[1.5] text-muted-ink narrow:text-[15px]">{g.description}</p>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/** A game link: signed out, it opens the sign-in dialog first (then goes to the game). */
function useGameLink(loggedIn: boolean) {
  const showLogin = useLoginDialog((s) => s.show);
  return (slug: string) => ({
    href: `/play/${slug}`,
    onClick: (e: React.MouseEvent) => {
      if (loggedIn) return;
      e.preventDefault();
      showLogin(`/play/${slug}`);
    },
  });
}

function PlayGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5" fill="currentColor" aria-hidden>
      <path d="M7 4.5v15l12.5-7.5z" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */

function LeaderboardSection() {
  return (
    <section id="liderlik" className="border-t border-line">
      <div className="mx-auto grid max-w-[1280px] gap-12 px-5 py-24 sm:px-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16 lg:py-32 narrow:gap-8 narrow:py-16 short:py-14">
        <div>
          <h2 className="display-2 text-[clamp(2.6rem,5.4vw,5rem)]">
            Liderlik
            <br />
            tablosu.
          </h2>
          <p className="mt-5 max-w-[28rem] text-[17px] leading-[1.55] text-muted-ink narrow:text-[16px]">
            Her oyundan çıktığında o turda kazandığın puan hanene eklenir. Genel tablo dört oyunun toplamı.
          </p>
          <Link href="/liderlik" className="ghost mt-8 narrow:mt-6">
            Tüm tabloyu gör
          </Link>
        </div>
        <LeaderboardPanel limit={10} />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function Footer() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 pt-10 text-[14px] text-muted-ink sm:px-10 narrow:pt-8 narrow:text-[13px]">
        <Wordmark className="text-ink" />
        <nav className="flex items-center gap-5">
          <Link href="/games" className="hover:text-ink">Oyunlar</Link>
          <Link href="/liderlik" className="hover:text-ink">Liderlik tablosu</Link>
        </nav>
        <p className="w-full">Oyunlar klavye ve fareyle, telefonda dokunmatik tuşlarla oynanır.</p>
        <p className="w-full max-w-[52rem] text-[13px] leading-[1.55] narrow:text-[12px]">
          Şarkı: {MUSIC.artist}, {MUSIC.title}. Şarkının{" "}
          <a href={MUSIC.youtubeUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-ink">
            YouTube&apos;daki resmi videosu
          </a>{" "}
          sayfada görünen YouTube oynatıcısıyla çalar; site şarkıyı barındırmaz ya da kopyalamaz. Şarkının tüm hakları sahiplerine
          aittir. Bu site hayran yapımı, ticari olmayan bir projedir; sanatçı ya da yapımcısıyla bir bağlantısı yoktur.
        </p>
      </div>
      <div aria-hidden className="overflow-hidden">
        <div className="select-none whitespace-nowrap text-center text-[20vw] font-extrabold leading-[0.9] tracking-[-0.07em] text-ink translate-y-[12%]">
          saygımdan
        </div>
      </div>
    </footer>
  );
}
