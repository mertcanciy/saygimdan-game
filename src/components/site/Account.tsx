"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, Trophy } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useHydrated, useLoginDialog, useUserStore } from "@/lib/store";

/** Nav link to the leaderboard (every site page). */
export function NavLeaderboard() {
  return (
    <Link href="/liderlik" className="inline-flex min-h-10 items-center gap-1.5 hover:text-ink transition-colors">
      <Trophy className="size-4" aria-hidden />
      Liderlik
    </Link>
  );
}

/** Signed out: "Giriş yap". Signed in: the name, with a small menu (my rank / sign out). */
export function NavAccount({ className = "" }: { className?: string }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const user = useUserStore((s) => s.user);
  const clearUser = useUserStore((s) => s.clearUser);
  const showLogin = useLoginDialog((s) => s.show);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useValidateSession();

  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", off);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", off);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  if (!hydrated) return <span className={className} />;
  if (!user)
    return (
      <span className={className}>
        <button type="button" onClick={() => showLogin(null)} className="inline-flex min-h-10 items-center whitespace-nowrap hover:text-ink">
          Giriş yap
        </button>
      </span>
    );

  return (
    <div ref={box} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="inline-flex min-h-10 max-w-[10rem] items-center gap-1 font-medium text-ink"
      >
        <span className="truncate">{user.name}</span>
        <ChevronDown className={`size-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-50 mt-2 w-64 rounded-2xl border border-line bg-paper p-2 text-[15px] shadow-[0_20px_50px_-20px_rgba(0,0,0,0.3)] animate-fade-up">
          <p className="px-3 pb-2 pt-1.5 text-[13px] text-muted-ink">
            {user.via === "google" ? "Google ile giriş" : user.via === "mail" ? "Mail ile giriş" : "Kullanıcı adı ve şifre"}
          </p>
          <Link href="/liderlik" role="menuitem" onClick={() => setOpen(false)} className="block rounded-xl px-3 py-2.5 font-medium text-ink hover:bg-soft">
            Sıralamam
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              clearUser();
              router.push("/");
            }}
            className="block w-full rounded-xl px-3 py-2.5 text-left font-medium text-ink hover:bg-soft"
          >
            Çıkış yap
          </button>
        </div>
      )}
    </div>
  );
}

/** Once per page load: a token the server no longer knows (merged away) signs the device out. */
let validated = false;
function useValidateSession() {
  const user = useUserStore((s) => s.user);
  useEffect(() => {
    if (!user || validated) return;
    validated = true;
    api
      .me()
      .then(({ player }) => {
        if (player.name !== user.name || player.via !== user.via) useUserStore.getState().setUser({ ...user, ...player });
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) useUserStore.getState().clearUser();
      });
  }, [user]);
}
