"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Check, Loader2, X } from "lucide-react";
import { ApiError, checkName, signIn } from "@/lib/api";
import { NAME_RE, PIN_RE, cleanName } from "@/lib/leaderboard";
import { useAuthDialog, useMusicStore, useUserStore } from "@/lib/store";
import { Pill } from "./Chrome";

type NameState = "idle" | "checking" | "free" | "taken" | "invalid" | "unknown";

const ERRORS: Record<string, string> = {
  wrong_pin: "PIN tutmadı. Bu isim başka birinin olabilir, farklı bir isim dene.",
  rate_limited: "Çok fazla deneme oldu. Birkaç dakika sonra tekrar dene.",
  bad_name: "İsim 3–16 karakter olmalı: harf, rakam, boşluk, _ . -",
  bad_pin: "PIN 4 rakam olmalı.",
  try_again: "Bir şey ters gitti, tekrar dene.",
};

/**
 * Sign-in popup: a username and a 4-digit PIN, no e-mail. A free name is
 * claimed on the spot; a taken one asks for its PIN (same form, so signing
 * in on a second device is the same two fields). Mounted once in the root
 * layout, opened with useAuthDialog().show().
 */
export default function AuthDialog() {
  const { open, next, required, close } = useAuthDialog();
  const router = useRouter();
  const pathname = usePathname();

  // navigating away (e.g. back button) dismisses it
  const openedAt = useRef(pathname);
  useEffect(() => {
    if (open) openedAt.current = pathname;
  }, [open, pathname]);
  useEffect(() => {
    if (open && openedAt.current !== pathname) close();
  }, [open, pathname, close]);

  if (!open) return null;

  const dismiss = () => {
    close();
    if (required) router.push("/");
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/45 animate-[fade-in_0.2s_ease-out_both] sm:items-center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) dismiss();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-title"
        className="relative w-full max-w-[28rem] rounded-t-[26px] bg-paper px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-7 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.5)] animate-[sheet-up_0.32s_cubic-bezier(0.2,0.9,0.3,1)_both] sm:rounded-[26px] sm:p-9 short:max-h-[100dvh] short:overflow-y-auto short:py-5"
      >
        <button
          type="button"
          onClick={dismiss}
          aria-label="Kapat"
          className="absolute right-4 top-4 grid size-10 place-items-center rounded-full text-muted-ink hover:bg-soft hover:text-ink"
        >
          <X className="size-5" />
        </button>
        <AuthForm
          onDone={() => {
            close();
            if (next) router.push(next);
          }}
        />
      </div>
    </div>
  );
}

function AuthForm({ onDone }: { onDone: () => void }) {
  const setUser = useUserStore((s) => s.setUser);
  const lastName = useUserStore((s) => s.lastName);
  const startMusic = useMusicStore((s) => s.start);
  const [name, setName] = useState(lastName);
  const [pin, setPin] = useState("");
  const [remote, setRemote] = useState<{ name: string; state: NameState } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);
  const pinRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (lastName ? pinRef : nameRef).current?.focus();
  }, [lastName]);

  // live "is this name free?" while typing
  const clean = cleanName(name);
  const valid = NAME_RE.test(clean);
  const nameState: NameState = !clean ? "idle" : !valid ? "invalid" : remote?.name === clean ? remote.state : "checking";
  useEffect(() => {
    if (!valid) return;
    const ctl = new AbortController();
    const t = setTimeout(() => {
      checkName(clean, ctl.signal).then(
        (r) => setRemote({ name: clean, state: r.available ? "free" : "taken" }),
        (e: unknown) => {
          if (ctl.signal.aborted) return;
          setRemote({ name: clean, state: "unknown" });
          if (e instanceof ApiError && e.status === 503) setOffline(true);
        }
      );
    }, 300);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [clean, valid]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!NAME_RE.test(clean)) return setError(ERRORS.bad_name);
    if (!PIN_RE.test(pin)) {
      pinRef.current?.focus();
      return setError(nameState === "taken" ? "Bu ismin 4 haneli PIN'ini yaz." : "4 haneli bir PIN seç, başka cihazdan girerken lazım olacak.");
    }
    setError(null);
    setBusy(true);
    // phones only allow sound to start inside the tap itself
    startMusic();
    try {
      const r = await signIn(clean, pin);
      setUser({ name: r.name, token: r.token });
      onDone();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "try_again";
      if (err instanceof ApiError && (err.status === 503 || err.status === 0 || err.status >= 500)) setOffline(true);
      else setError(ERRORS[code] ?? ERRORS.try_again);
      if (code === "wrong_pin") {
        setPin("");
        pinRef.current?.focus();
      }
    } finally {
      setBusy(false);
    }
  };

  const playAsGuest = () => {
    startMusic();
    setUser({ name: clean || "Misafir", token: null });
    onDone();
  };

  const taken = nameState === "taken";

  return (
    <form onSubmit={submit} noValidate>
      <p className="text-[14px] font-semibold text-red">Liderlik tablosuna gir</p>
      <h2 id="auth-title" className="display-2 mt-1.5 pr-10 text-[clamp(2.1rem,6vw,2.6rem)] short:text-[1.9rem]">
        {taken ? "Tekrar hoş geldin." : "Adını yaz, şehre in."}
      </h2>

      <label htmlFor="auth-name" className="mt-6 block text-[14px] text-muted-ink short:mt-3">
        Kullanıcı adı
      </label>
      <div className="relative">
        <input
          ref={nameRef}
          id="auth-name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          maxLength={20}
          autoComplete="username"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="ada"
          suppressHydrationWarning
          className="mt-1 w-full border-0 border-b-2 border-line bg-transparent py-2.5 pr-9 text-[1.75rem] font-semibold tracking-[-0.03em] text-ink outline-none transition-colors placeholder:text-[#cfcfcd] focus:border-ink focus-visible:outline-none short:py-1.5 short:text-[1.4rem]"
        />
        <span className="absolute right-0 top-1/2 -translate-y-1/2">
          {nameState === "checking" && <Loader2 aria-hidden className="size-5 animate-spin text-muted-ink" />}
          {nameState === "free" && <Check aria-hidden className="size-5 text-[#16a34a]" />}
        </span>
      </div>
      <p aria-live="polite" className="mt-2 min-h-[1.25rem] text-[13.5px] leading-[1.4] text-muted-ink">
        {nameState === "free" && "Bu isim boşta, senin olsun."}
        {taken && "Bu isim alınmış. Seninse PIN'ini gir."}
        {nameState === "invalid" && "3–16 karakter: harf, rakam, boşluk, _ . -"}
      </p>

      <label htmlFor="auth-pin" className="mt-3 block text-[14px] text-muted-ink short:mt-1">
        {taken ? "PIN" : "4 haneli PIN seç"}
      </label>
      <input
        ref={pinRef}
        id="auth-pin"
        value={pin}
        onChange={(e) => {
          setPin(e.target.value.replace(/\D/g, "").slice(0, 4));
          setError(null);
        }}
        inputMode="numeric"
        autoComplete={taken ? "current-password" : "new-password"}
        type="password"
        maxLength={4}
        placeholder="••••"
        suppressHydrationWarning
        className="mt-1 w-full border-0 border-b-2 border-line bg-transparent py-2.5 font-mono text-[1.75rem] tracking-[0.5em] text-ink outline-none transition-colors placeholder:text-[#cfcfcd] focus:border-ink focus-visible:outline-none short:py-1.5 short:text-[1.4rem]"
      />
      <p className="mt-2 text-[13.5px] leading-[1.4] text-muted-ink">
        {taken ? "PIN'i unuttuysan farklı bir isimle devam edebilirsin." : "E-posta yok. Başka cihazdan girerken ismin ve bu PIN yeter."}
      </p>

      {error && (
        <p role="alert" className="mt-4 text-[14px] text-[#d92d20] animate-fade-up">
          {error}
        </p>
      )}

      {offline ? (
        <div className="mt-6 rounded-2xl bg-soft p-4 animate-fade-up short:mt-3">
          <p className="text-[14px] leading-[1.45] text-ink">Liderlik tablosuna şu an ulaşılamıyor. Misafir olarak oynayabilirsin, skorların tabloya girmez.</p>
          <div className="mt-3 flex flex-wrap gap-3">
            <Pill small play onClick={playAsGuest}>
              Misafir olarak oyna
            </Pill>
          </div>
        </div>
      ) : (
        <div className="mt-7 short:mt-4">
          <button type="submit" disabled={busy} className="pill w-full justify-center">
            {busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}
            <span>{taken ? "Giriş yap ve oyna" : "Oyna"}</span>
          </button>
        </div>
      )}
    </form>
  );
}
