"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { GAMES } from "@/lib/games";
import { useHydrated, useMusicStore, useUserStore } from "@/lib/store";
import { Keys, Pill, SiteNav, Wordmark } from "@/components/site/Chrome";
import GameShot from "@/components/site/GameShot";

export default function Landing() {
  const router = useRouter();
  const hydrated = useHydrated();
  const user = useUserStore((s) => s.user);
  const startMusic = useMusicStore((s) => s.start);
  const loggedIn = hydrated && !!user;

  const play = () => {
    startMusic();
    if (loggedIn) router.push("/games");
    else document.getElementById("giris")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <>
      <SiteNav>
        <a href="#oyunlar" className="hidden sm:inline hover:text-ink transition-colors">
          Oyunlar
        </a>
        <a href="#giris" className="hidden sm:inline hover:text-ink transition-colors">
          {loggedIn ? "Hesap" : "Giriş"}
        </a>
        <Pill small onClick={play}>
          {loggedIn ? "Oyunlara git" : "Oyna"}
        </Pill>
      </SiteNav>

      <main>
        <Hero onPlay={play} />
        <GamesPinned loggedIn={loggedIn} />
        <SignIn />
      </main>

      <Footer />
    </>
  );
}

/* ------------------------------------------------------------------ */

function Hero({ onPlay }: { onPlay: () => void }) {
  return (
    <section className="mx-auto flex min-h-[calc(100svh-var(--nav-h)-40px)] max-w-[1280px] flex-col items-center justify-center px-5 pb-24 pt-14 text-center sm:px-10">
      <h1 className="display text-[clamp(3.4rem,11.2vw,10.5rem)]">
        <span className="rise">
          <span>Şarkı çalıyor.</span>
        </span>
        <span className="rise">
          <span>
            Şehir <span className="mark">senin</span>.
          </span>
        </span>
      </h1>

      <p className="mt-8 max-w-[36rem] text-[clamp(1.05rem,1.6vw,1.3rem)] leading-[1.5] text-muted-ink animate-fade-up [animation-delay:0.5s]">
        Bengü&apos;nün Saygımdan&apos;ı arkada dönerken gökdelenlerin arasında ağ at, gece meydanında drift yap,
        F-16 ile çatıları sıyır. Kurulum yok, tarayıcında açılır.
      </p>

      <div className="mt-10 flex flex-wrap items-center justify-center gap-3 animate-fade-up [animation-delay:0.65s]">
        <Pill onClick={onPlay}>Oynamaya başla</Pill>
        <a href="#oyunlar" className="ghost">
          Oyunlara bak
        </a>
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
  const hrefFor = (slug: string) => (loggedIn ? `/play/${slug}` : "#giris");

  return (
    <section id="oyunlar" ref={ref} className="relative border-t border-line lg:h-[360vh]">
      <div className="lg:sticky lg:top-[var(--nav-h)] lg:h-[calc(100svh-var(--nav-h))]">
        <div className="mx-auto grid h-full max-w-[1280px] items-center gap-10 px-5 py-16 sm:px-10 lg:grid-cols-[0.8fr_1.35fr] lg:gap-16 lg:py-10">
          {/* list */}
          <div>
            <h2 className="display-2 text-[clamp(2.4rem,4.6vw,4.2rem)]">Dört oyun, tek şarkı.</h2>
            <p className="mt-4 max-w-[26rem] text-[17px] leading-[1.55] text-muted-ink">
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
              href={hrefFor(game.slug)}
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
                  <span>Oyna</span>
                  <span className="disc" aria-hidden>
                    <ArrowGlyph />
                  </span>
                </span>
              </div>
            </Link>
            <p className="mt-3 text-right text-[13px] tabular-nums text-muted-ink">
              {active + 1} / {GAMES.length}
            </p>
          </div>

          {/* stacked list (mobile / tablet) */}
          <ul className="grid gap-10 lg:hidden">
            {GAMES.map((g) => (
              <li key={g.slug}>
                <Link href={hrefFor(g.slug)} className="block">
                  <div className="aspect-[16/10] overflow-hidden rounded-[18px] bg-soft">
                    <GameShot slug={g.slug} alt={`${g.title} oyunundan bir kare`} />
                  </div>
                  <h3 className="mt-4 text-[28px] font-bold tracking-[-0.035em]">{g.title}</h3>
                  <p className="mt-1 text-[16px] leading-[1.5] text-muted-ink">{g.description}</p>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function ArrowGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */

function SignIn() {
  const router = useRouter();
  const hydrated = useHydrated();
  const { user, setUser, clearUser } = useUserStore();
  const startMusic = useMusicStore((s) => s.start);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<{ field: "name" | "email"; text: string } | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError({ field: "name", text: "Adını yaz, skorların yanında görünecek." });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      return setError({ field: "email", text: "E-posta adresi eksik ya da hatalı. Örnek: ada@mail.com" });
    setError(null);
    setUser({ name: name.trim(), email: email.trim() });
    startMusic();
    router.push("/games");
  };

  return (
    <section id="giris" className="border-t border-line">
      <div className="mx-auto grid max-w-[1280px] gap-12 px-5 py-24 sm:px-10 lg:grid-cols-2 lg:py-32">
        <div>
          <h2 className="display-2 text-[clamp(2.6rem,5.4vw,5rem)]">
            Adını yaz,
            <br />
            şehre in.
          </h2>
          <p className="mt-5 max-w-[28rem] text-[17px] leading-[1.55] text-muted-ink">
            Hesap açmak yok. Adın ve e-postan sadece bu tarayıcıda saklanır, hiçbir yere gönderilmez.
          </p>
        </div>

        {hydrated && user ? (
          <div className="self-end">
            <p className="text-[clamp(1.6rem,2.6vw,2.2rem)] font-semibold tracking-[-0.03em]">
              Tekrar hoş geldin, {user.name}.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Pill
                onClick={() => {
                  startMusic();
                  router.push("/games");
                }}
              >
                Oyunlara geç
              </Pill>
              <button type="button" onClick={clearUser} className="text-[15px] text-muted-ink underline underline-offset-4 hover:text-ink">
                Farklı isimle gir
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} noValidate className="self-end">
            <Field
              id="name"
              label="Adın"
              value={name}
              onChange={setName}
              autoComplete="given-name"
              placeholder="Ada"
              error={error?.field === "name" ? error.text : undefined}
            />
            <Field
              id="email"
              label="E-posta"
              type="email"
              value={email}
              onChange={setEmail}
              autoComplete="email"
              placeholder="ada@mail.com"
              error={error?.field === "email" ? error.text : undefined}
            />
            <div className="mt-10">
              <Pill type="submit">Oyunlara geç</Pill>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  type = "text",
  autoComplete,
  placeholder,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  autoComplete?: string;
  placeholder?: string;
  error?: string;
}) {
  return (
    <div className="mt-6 first:mt-0">
      <label htmlFor={id} className="block text-[15px] text-muted-ink">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        placeholder={placeholder}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-err` : undefined}
        className="mt-1 w-full border-0 border-b-2 border-line bg-transparent py-3 text-[clamp(1.5rem,2.6vw,2.2rem)] font-semibold tracking-[-0.03em] text-ink outline-none transition-colors placeholder:text-[#cfcfcd] focus:border-ink focus-visible:outline-none aria-[invalid=true]:border-[#d92d20]"
      />
      {error && (
        <p id={`${id}-err`} className="mt-2 text-[14px] text-[#d92d20] animate-fade-up">
          {error}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Footer() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-4 px-5 pt-10 text-[14px] text-muted-ink sm:px-10">
        <Wordmark className="text-ink" />
        <p>Şarkı: Bengü, Saygımdan. Oyunlar klavye ve fareyle oynanır.</p>
      </div>
      <div aria-hidden className="overflow-hidden">
        <div className="select-none whitespace-nowrap text-center text-[21.5vw] font-extrabold leading-[0.9] tracking-[-0.07em] text-ink translate-y-[12%]">
          saygımdan
        </div>
      </div>
    </footer>
  );
}
