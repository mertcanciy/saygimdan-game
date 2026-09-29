"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Eye, EyeOff, Mail, X } from "lucide-react";
import { api, ApiError, signedIn, SignInResult } from "@/lib/api";
import {
  finishMailLink,
  firebaseEnabled,
  firebaseErrorText,
  googleIdToken,
  isMailLink,
  preloadFirebase,
  rememberedMail,
  sendMailLink,
} from "@/lib/firebaseClient";
import { checkName, checkPassword, NAME_MAX, PASSWORD_MAX } from "@/lib/scores";
import { useLoginDialog, useUserStore } from "@/lib/store";
import { Pill } from "./Chrome";
import { refreshBoards } from "./Leaderboard";

/*
 * One dialog for every way in (mounted once in the root layout; open it with
 * useLoginDialog().show(next)):
 *   name + password → one form: signs in if the name is taken, opens the account if not
 *   Google          → Firebase popup; mail → Firebase sign-in link (then a name)
 */
type View =
  | { v: "start" }
  | { v: "mail" }
  | { v: "sent"; email: string; nonce: string }
  | { v: "pickName"; idToken: string; suggestion: string }
  | { v: "finish"; href: string; nonce: string | null; askMail: boolean }
  | { v: "done"; name: string; elsewhere: boolean };

export default function LoginDialog() {
  const router = useRouter();
  const { open, next, hide, show } = useLoginDialog();
  const lastName = useUserStore((s) => s.lastName);
  const [view, setView] = useState<View>({ v: "start" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const panel = useRef<HTMLDivElement>(null);
  // mail link finished here but a name is still needed: hand off after the name
  const pendingNonce = useRef<string | null>(null);

  // coming back from the mail link (/?giris=mail&oobCode=…)
  useEffect(() => {
    const href = window.location.href;
    if (!isMailLink(href)) return;
    const nonce = new URL(href).searchParams.get("n");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of the URL on load
    setView({ v: "finish", href, nonce, askMail: !rememberedMail() });
    show(null);
    window.history.replaceState(window.history.state, "", "/");
  }, [show]);

  useEffect(() => {
    if (!open) return;
    preloadFirebase();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // first field (or the panel) gets focus
    requestAnimationFrame(() => {
      (panel.current?.querySelector("input, button[data-autofocus]") as HTMLElement | null)?.focus();
    });
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, view.v]);

  // waiting for the mail link to be opened (maybe in another app / device)
  useEffect(() => {
    if (!open || view.v !== "sent") return;
    const nonce = view.nonce;
    let stop = false;
    const tick = async () => {
      if (stop || document.visibilityState !== "visible") return;
      const r = await api.handoffTake(nonce).catch(() => null);
      if (stop || !r || "pending" in r) return;
      stop = true;
      finish(r, true);
    };
    const t = setInterval(tick, 2500);
    document.addEventListener("visibilitychange", tick);
    return () => {
      stop = true;
      clearInterval(t);
      document.removeEventListener("visibilitychange", tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, view]);

  if (!open) return null;

  function close() {
    hide();
    setError("");
    setBusy(false);
    setView({ v: "start" });
  }

  function finish(r: { player: Parameters<typeof signedIn>[0]["player"]; token: string }, elsewhere = false) {
    signedIn(r);
    refreshBoards();
    const goTo = next;
    if (view.v === "finish" || elsewhere) {
      setView({ v: "done", name: r.player.name, elsewhere: view.v === "finish" && !!view.nonce });
      return;
    }
    close();
    if (goTo) router.push(goTo);
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : firebaseErrorText(e));
    } finally {
      setBusy(false);
    }
  }

  /** after Google / the mail link: signed in, or pick a name first */
  async function withIdToken(idToken: string, nonce: string | null) {
    const r: SignInResult = await api.firebase(idToken);
    if ("needsName" in r) {
      setView({ v: "pickName", idToken, suggestion: r.suggestion });
      pendingNonce.current = nonce;
      return;
    }
    signedIn(r);
    if (nonce) await api.handoffPut(nonce).catch(() => {});
    finish(r);
  }
  /** a new Google / mail account picks its leaderboard name */
  const submitName = (e: React.FormEvent<HTMLFormElement>, idToken: string) => {
    e.preventDefault();
    const raw = String(new FormData(e.currentTarget).get("name") ?? "");
    const checked = checkName(raw);
    if ("error" in checked) return setError(checked.error);
    void run(async () => {
      const r = await api.createPlayer(checked.name, idToken);
      signedIn(r);
      if (pendingNonce.current) await api.handoffPut(pendingNonce.current).catch(() => {});
      finish(r);
    });
  };

  const google = () =>
    run(async () => {
      const idToken = await googleIdToken();
      await withIdToken(idToken, null);
    });

  const sendMail = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get("email") ?? "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setError("E-posta adresi eksik ya da hatalı.");
    const nonce = crypto.randomUUID().replaceAll("-", "");
    void run(async () => {
      await sendMailLink(email, nonce);
      setView({ v: "sent", email, nonce });
    });
  };

  const finishMail = (e?: React.FormEvent<HTMLFormElement>) => {
    e?.preventDefault();
    if (view.v !== "finish") return;
    const email = e ? String(new FormData(e.currentTarget).get("email") ?? "").trim() : rememberedMail();
    if (!email) return;
    void run(async () => {
      const idToken = await finishMailLink(email, view.href);
      await withIdToken(idToken, view.nonce);
    });
  };

  const title =
    view.v === "done"
      ? "Giriş tamam."
      : view.v === "pickName"
        ? "Son adım: adın."
        : view.v === "mail" || view.v === "sent" || view.v === "finish"
          ? "Mail ile giriş"
          : "Şehre in.";

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center" role="presentation">
      <button type="button" aria-label="Kapat" onClick={close} className="absolute inset-0 bg-ink/45 animate-fade-in" tabIndex={-1} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-title"
        className="relative max-h-[92dvh] w-full max-w-[30rem] overflow-y-auto rounded-t-[28px] bg-paper p-7 pb-[max(1.75rem,env(safe-area-inset-bottom))] shadow-[0_30px_80px_-30px_rgba(0,0,0,0.45)] animate-sheet-up sm:rounded-[28px] sm:p-9 short:max-w-[36rem] short:p-6"
      >
        <div className="mb-5 flex items-center justify-between">
          {view.v === "mail" || (view.v === "sent" && !busy) ? (
            <button
              type="button"
              onClick={() => {
                setError("");
                setView({ v: "start" });
              }}
              className="-ml-2 grid size-10 place-items-center rounded-full text-ink hover:bg-soft"
              aria-label="Geri"
            >
              <ArrowLeft className="size-5" />
            </button>
          ) : (
            <span />
          )}
          <button type="button" onClick={close} className="-mr-2 grid size-10 place-items-center rounded-full text-ink hover:bg-soft" aria-label="Kapat">
            <X className="size-5" />
          </button>
        </div>

        <h2 id="login-title" className="display-2 text-[clamp(2.2rem,6vw,3rem)] short:text-[2rem]">
          {title}
        </h2>

        {view.v === "start" && (
          <>
            <PasswordForm defaultName={lastName} busy={busy} setBusy={setBusy} onDone={finish} />
            {firebaseEnabled && (
              <>
                <div className="my-7 flex items-center gap-4 text-[13px] font-medium text-muted-ink short:my-4">
                  <span className="h-px flex-1 bg-line" />
                  ya da
                  <span className="h-px flex-1 bg-line" />
                </div>
                <div className="grid gap-2.5">
                  <button type="button" onClick={google} disabled={busy} className="provider">
                    <GoogleMark />
                    Google ile devam et
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setError("");
                      setView({ v: "mail" });
                    }}
                    disabled={busy}
                    className="provider"
                  >
                    <Mail className="size-[18px]" />
                    Mail ile giriş yap
                  </button>
                </div>
                {error && <ErrorText text={error} />}
              </>
            )}
            <p className="mt-5 text-[13.5px] leading-[1.5] text-muted-ink">
              Adın liderlik tablosunda görünür. {firebaseEnabled ? "Mailini sadece giriş için kullanırız." : "E-posta istemiyoruz."}
            </p>
          </>
        )}

        {view.v === "mail" && (
          <form onSubmit={sendMail} noValidate className="mt-6">
            <p className="mb-5 text-[16px] leading-[1.55] text-muted-ink">Mailine bir giriş linki gönderelim. Şifre yok.</p>
            <MailField error={error} />
            <div className="mt-6">
              <Pill type="submit" disabled={busy}>
                {busy ? "Gönderiliyor…" : "Link gönder"}
              </Pill>
            </div>
          </form>
        )}

        {view.v === "sent" && (
          <div className="mt-5">
            <p className="text-[16px] leading-[1.55] text-ink">
              <b className="font-semibold">{view.email}</b> adresine bir link gönderdik. Linke dokun, burası kendiliğinden giriş yapar.
            </p>
            <p className="mt-3 text-[14px] leading-[1.5] text-muted-ink">
              Linki telefonda ya da başka bir tarayıcıda açman da olur. Birkaç dakikada gelmezse spam klasörüne bak.
            </p>
            <p className="mt-6 inline-flex items-center gap-2 text-[14px] font-medium text-muted-ink">
              <span aria-hidden className="size-2 animate-pulse rounded-full bg-red" />
              Link bekleniyor
            </p>
          </div>
        )}

        {view.v === "finish" && (
          <div className="mt-5">
            {view.askMail ? (
              <form onSubmit={finishMail} noValidate>
                <p className="mb-5 text-[16px] leading-[1.55] text-muted-ink">Linki başka bir cihazda açtın. Aynı mail adresini tekrar yaz.</p>
                <MailField error={error} />
                <div className="mt-6">
                  <Pill type="submit" disabled={busy}>
                    {busy ? "Giriş yapılıyor…" : "Giriş yap"}
                  </Pill>
                </div>
              </form>
            ) : (
              <>
                <p className="text-[16px] leading-[1.55] text-muted-ink">Linkin geldi. Tek dokunuşla giriş yap.</p>
                {error && <ErrorText text={error} />}
                <div className="mt-6">
                  <Pill onClick={() => finishMail()} disabled={busy}>
                    {busy ? "Giriş yapılıyor…" : "Giriş yap"}
                  </Pill>
                </div>
              </>
            )}
          </div>
        )}

        {view.v === "pickName" && (
          <form onSubmit={(e) => submitName(e, view.idToken)} noValidate className="mt-6">
            <p className="mb-5 text-[16px] leading-[1.55] text-muted-ink">Liderlik tablosunda bu isimle görüneceksin.</p>
            <PickNameField defaultValue={view.suggestion || lastName} error={error} />
            <div className="mt-6">
              <Pill type="submit" play disabled={busy}>
                {busy ? "Bir saniye…" : "Oyna"}
              </Pill>
            </div>
          </form>
        )}

        {view.v === "done" && (
          <div className="mt-5">
            <p className="text-[17px] leading-[1.55] text-ink">
              Hoş geldin, <b className="font-semibold">{view.name}</b>.
              {view.elsewhere && " Linki istediğin pencere ya da uygulama da giriş yaptı, oraya dönebilirsin."}
            </p>
            <div className="mt-6">
              <Pill
                play
                onClick={() => {
                  close();
                  router.push(next ?? "/games");
                }}
              >
                Oyunlara geç
              </Pill>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

type NameStatus = "idle" | "checking" | "new" | "existing" | "firebase";

/**
 * Name + password in one form. While the name is typed, the server says
 * whether it's taken: taken → "Giriş yap" with the password, free → "Hesap aç"
 * (the password becomes the account's). Password managers see a normal
 * username + password form.
 */
function PasswordForm({
  defaultName,
  busy,
  setBusy,
  onDone,
}: {
  defaultName: string;
  busy: boolean;
  setBusy: (b: boolean) => void;
  onDone: (r: { player: Parameters<typeof signedIn>[0]["player"]; token: string }) => void;
}) {
  const [name, setName] = useState(defaultName);
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [status, setStatus] = useState<{ s: NameStatus; for: string; via?: string }>({ s: "idle", for: "" });
  const [err, setErr] = useState<{ field: "name" | "password"; text: string } | null>(null);

  const checked = checkName(name);
  const clean = "name" in checked ? checked.name : "";

  // ask the server about the name, a moment after typing stops
  useEffect(() => {
    if (!clean) return;
    const ctl = new AbortController();
    const t = setTimeout(() => {
      setStatus({ s: "checking", for: clean });
      api
        .nameStatus(clean, ctl.signal)
        .then((r) => setStatus({ s: !r.exists ? "new" : r.via === "password" ? "existing" : "firebase", for: clean, via: r.via }))
        .catch(() => !ctl.signal.aborted && setStatus({ s: "idle", for: clean }));
    }, 350);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [clean]);

  const st = clean && status.for === clean ? status.s : "idle";

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if ("error" in checked) return setErr({ field: "name", text: checked.error });
    if (st === "firebase") return setErr({ field: "name", text: firebaseText(status.via) });
    if (!password) return setErr({ field: "password", text: "Şifreni yaz." });
    if (st !== "existing") {
      const bad = checkPassword(password);
      if (bad) return setErr({ field: "password", text: bad });
    }
    setErr(null);
    setBusy(true);
    // unknown status (slow network): try signing in, fall back to opening the account
    const go = async () => {
      if (st === "new") return api.register(clean, password);
      try {
        return await api.login(clean, password);
      } catch (e) {
        if (st === "idle" && e instanceof ApiError && e.status === 401 && e.field === "name" && !checkPassword(password))
          return api.register(clean, password);
        throw e;
      }
    };
    go()
      .then(onDone)
      .catch((e) => {
        const field = e instanceof ApiError && e.field === "name" ? "name" : "password";
        setErr({ field, text: e instanceof Error ? e.message : "Bir şeyler ters gitti, tekrar dene." });
        // taken meanwhile: ask again
        if (field === "name") setStatus({ s: "idle", for: "" });
      })
      .finally(() => setBusy(false));
  };

  const hint =
    st === "new"
      ? "Bu ad boşta: bir şifre belirle, hesabın açılsın."
      : st === "existing"
        ? "Bu ad kayıtlı. Seninse şifreni gir."
        : st === "firebase"
          ? firebaseText(status.via)
          : "";

  return (
    <form onSubmit={submit} noValidate className="mt-6 short:mt-4">
      <NameField
        value={name}
        onChange={(v) => {
          setName(v);
          if (err?.field === "name") setErr(null);
        }}
        error={err?.field === "name" ? err.text : ""}
      />
      <p aria-live="polite" className={`mt-2 min-h-[1.4em] text-[13.5px] ${st === "firebase" ? "text-[#d92d20]" : "text-muted-ink"}`}>
        {err?.field === "name" ? "" : hint}
      </p>
      <div className="mt-3">
        <label htmlFor="login-pw" className="block text-[15px] text-muted-ink">
          Şifre
        </label>
        <div className="relative">
          <input
            id="login-pw"
            name="password"
            type={show ? "text" : "password"}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (err?.field === "password") setErr(null);
            }}
            maxLength={PASSWORD_MAX}
            autoComplete={st === "new" ? "new-password" : "current-password"}
            enterKeyHint="go"
            placeholder={st === "new" ? "en az 6 karakter" : "••••••"}
            aria-invalid={err?.field === "password"}
            aria-describedby={err?.field === "password" ? "login-err" : undefined}
            className="field-input pr-12"
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            aria-label={show ? "Şifreyi gizle" : "Şifreyi göster"}
            className="absolute right-0 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full text-muted-ink hover:text-ink"
          >
            {show ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
          </button>
        </div>
        {err?.field === "password" && <ErrorText text={err.text} />}
      </div>
      <div className="mt-7 short:mt-5">
        <Pill type="submit" play disabled={busy || st === "firebase"}>
          {busy ? "Bir saniye…" : st === "new" ? "Hesap aç ve oyna" : st === "existing" ? "Giriş yap" : "Oyna"}
        </Pill>
      </div>
    </form>
  );
}

function firebaseText(via?: string) {
  return `Bu ad ${via === "google" ? "Google" : "mail"} ile açılmış. Aşağıdan ${via === "google" ? "Google" : "mail"} ile gir.`;
}

/** name only (new Google / mail account) */
function PickNameField({ defaultValue, error }: { defaultValue: string; error: string }) {
  const [v, setV] = useState(defaultValue);
  return <NameField value={v} onChange={setV} error={error} />;
}

function NameField({ value, onChange, error }: { value: string; onChange: (v: string) => void; error: string }) {
  return (
    <div>
      <label htmlFor="login-name" className="block text-[15px] text-muted-ink">
        Kullanıcı adı
      </label>
      <input
        id="login-name"
        name="name"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={NAME_MAX}
        autoComplete="username"
        autoCapitalize="words"
        spellCheck={false}
        enterKeyHint="go"
        placeholder="ada"
        aria-invalid={!!error}
        aria-describedby={error ? "login-err" : undefined}
        className="field-input"
      />
      {error && <ErrorText text={error} />}
    </div>
  );
}

function MailField({ error }: { error: string }) {
  return (
    <div>
      <label htmlFor="login-mail" className="block text-[15px] text-muted-ink">
        E-posta
      </label>
      <input
        id="login-mail"
        name="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        enterKeyHint="send"
        defaultValue={rememberedMail() ?? ""}
        placeholder="ada@mail.com"
        aria-invalid={!!error}
        aria-describedby={error ? "login-err" : undefined}
        className="field-input"
      />
      {error && <ErrorText text={error} />}
    </div>
  );
}

function ErrorText({ text }: { text: string }) {
  if (!text) return null;
  return (
    <p id="login-err" role="alert" className="mt-2 text-[14px] text-[#d92d20] animate-fade-up">
      {text}
    </p>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-[18px]" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.06H2.18A11 11 0 0 0 1 12c0 1.78.43 3.45 1.18 4.94l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
    </svg>
  );
}
