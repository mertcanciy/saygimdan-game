"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { GAMES } from "@/lib/games";
import { useHydrated, useUserStore } from "@/lib/store";
import { Keys, SiteNav } from "@/components/site/Chrome";
import GameShot from "@/components/site/GameShot";

export default function GamesPage() {
  const router = useRouter();
  const { user, clearUser } = useUserStore();
  const hydrated = useHydrated();

  useEffect(() => {
    if (hydrated && !user) router.replace("/#giris");
  }, [hydrated, user, router]);

  if (!hydrated || !user) return <main className="min-h-dvh" />;

  return (
    <>
      <SiteNav>
        <span className="hidden text-ink sm:inline">{user.name}</span>
        <button
          type="button"
          onClick={() => {
            clearUser();
            router.push("/");
          }}
          className="inline-flex min-h-10 items-center hover:text-ink"
        >
          Çıkış yap
        </button>
      </SiteNav>

      <main className="mx-auto max-w-[1280px] px-5 pb-40 pt-16 sm:px-10 sm:pt-24 narrow:pb-32 narrow:pt-10 short:pt-10">
        <h1 className="display-2 max-w-[16ch] text-[clamp(2.6rem,5.6vw,5rem)] narrow:text-[clamp(2.1rem,10.5vw,2.6rem)] short:text-[clamp(2.2rem,11dvh,3.2rem)]">
          Merhaba {user.name}. Nereden başlıyoruz?
        </h1>
        <p className="mt-5 max-w-[32rem] text-[17px] leading-[1.55] text-muted-ink narrow:mt-4 narrow:text-[16px]">
          Bir oyun seç. Şarkı sağ altta; oyun değiştirsen de kaldığı yerden devam eder.
        </p>

        <ul className="mt-16 border-t border-line narrow:mt-10 short:mt-10">
          {GAMES.map((g, i) => (
            <li key={g.slug} className="border-b border-line">
              <Link
                href={`/play/${g.slug}`}
                className="group grid items-center gap-6 py-8 md:grid-cols-[1fr_minmax(0,1.05fr)] md:gap-12 md:py-10 narrow:gap-5 narrow:py-7"
              >
                <div className="md:order-none">
                  <h2 className="text-[clamp(2.4rem,5vw,4.4rem)] font-extrabold leading-[0.95] tracking-[-0.055em] narrow:text-[2.2rem]">
                    <span className="bg-[linear-gradient(var(--yellow),var(--yellow))] bg-[length:0%_100%] bg-no-repeat px-1 -mx-1 transition-[background-size] duration-300 ease-out group-hover:bg-[length:100%_100%] group-focus-visible:bg-[length:100%_100%]">
                      {g.title}
                    </span>
                  </h2>
                  <p className="mt-3 text-[18px] font-medium tracking-[-0.01em] narrow:mt-2 narrow:text-[16px]">{g.subtitle}</p>
                  <p className="mt-2 max-w-[30rem] text-[15.5px] leading-[1.55] text-muted-ink narrow:text-[15px]">{g.description}</p>
                  {/* keyboard hints are noise on a phone */}
                  <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-muted-ink pointer-coarse:hidden">
                    {g.controls.slice(0, 3).map((c) => (
                      <span key={c.label} className="inline-flex items-center gap-1.5">
                        <Keys keys={c.keys} />
                        {c.label}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="aspect-[16/9] overflow-hidden rounded-[20px] bg-soft">
                  <GameShot
                    slug={g.slug}
                    alt={`${g.title} oyunundan bir kare`}
                    priority={i < 2}
                    className="transition-transform duration-500 ease-out group-hover:scale-[1.03]"
                  />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
