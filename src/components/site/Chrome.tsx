"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Play, Trophy, UserRound } from "lucide-react";
import { useAuthDialog, useHydrated, useUserStore } from "@/lib/store";

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <Link
      href="/"
      className={`inline-flex items-center gap-[0.22em] font-display text-[25px] font-black leading-none tracking-[-0.01em] [font-stretch:68%] ${className}`}
    >
      {/* a tiny record: red label, white spindle hole */}
      <span
        aria-hidden
        className="inline-block size-[0.62em] rounded-full bg-red [background-image:radial-gradient(circle,var(--paper)_0_16%,transparent_18%)] ring-[0.09em] ring-ink"
      />
      saygımdan
    </Link>
  );
}

/** Primary red button (optionally with a play glyph). Renders a Link when `href` is set. */
export function Pill({
  children,
  href,
  onClick,
  type = "button",
  small,
  disabled,
  play,
}: {
  children: React.ReactNode;
  href?: string;
  onClick?: () => void;
  type?: "button" | "submit";
  small?: boolean;
  disabled?: boolean;
  /** leading ▶ for buttons that start a game or the song */
  play?: boolean;
}) {
  const cls = `pill ${small ? "pill-sm" : ""}`;
  const inner = (
    <>
      {play && <Play aria-hidden className={`fill-current ${small ? "size-3.5" : "size-4"}`} strokeWidth={0} />}
      <span>{children}</span>
    </>
  );
  if (href)
    return (
      <Link href={href} className={cls} onClick={onClick}>
        {inner}
      </Link>
    );
  return (
    <button type={type} className={cls} onClick={onClick} disabled={disabled}>
      {inner}
    </button>
  );
}

/** Top bar: wordmark, page links (`children`), the leaderboard, the player. */
export function SiteNav({ children }: { children?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-40 h-[var(--nav-h)] border-b border-line bg-paper/90 backdrop-blur">
      <div className="mx-auto flex h-full max-w-[1280px] items-center justify-between gap-4 px-5 sm:gap-6 sm:px-10 narrow:px-4">
        <Wordmark />
        <nav className="flex items-center gap-2 sm:gap-8 text-[15px] text-muted-ink">
          <Link href="/leaderboard" className="inline-flex min-h-10 items-center gap-1.5 hover:text-ink transition-colors" aria-label="Liderlik Tablosu">
            <Trophy aria-hidden className="size-[18px] sm:size-4" />
            <span className="hidden sm:inline">Liderlik</span>
          </Link>
          <Account />
          {children}
        </nav>
      </div>
    </header>
  );
}

/** Signed in: name + sign out. Signed out: opens the sign-in dialog. */
function Account() {
  const router = useRouter();
  const hydrated = useHydrated();
  const user = useUserStore((s) => s.user);
  const clearUser = useUserStore((s) => s.clearUser);
  const show = useAuthDialog((s) => s.show);
  if (!hydrated) return null;
  if (!user)
    return (
      <button type="button" onClick={() => show()} className="inline-flex min-h-10 items-center gap-1.5 hover:text-ink transition-colors">
        <UserRound aria-hidden className="size-[18px] sm:hidden" />
        <span className="hidden sm:inline">Giriş</span>
      </button>
    );
  return (
    <span className="inline-flex items-center gap-2 sm:gap-3">
      <span className="hidden max-w-[10rem] truncate font-medium text-ink md:inline">{user.name}</span>
      <button
        type="button"
        onClick={() => {
          clearUser();
          router.push("/");
        }}
        className="inline-flex min-h-10 items-center hover:text-ink transition-colors"
      >
        Çıkış
      </button>
    </span>
  );
}

export function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="inline-flex gap-1">
      {keys.map((k) => (
        <kbd key={k} className="key">
          {k}
        </kbd>
      ))}
    </span>
  );
}
