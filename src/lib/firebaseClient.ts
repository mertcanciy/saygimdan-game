"use client";

/*
 * Firebase Auth, only for "Google ile devam et" / "Mail ile giriş yap". The SDK
 * is imported on first use so the site and the games don't carry it. Firebase
 * sends the sign-in mail itself (we have no mail domain). The server only sees
 * the ID token and checks it (lib/server/players.ts).
 */
import type { Auth } from "firebase/auth";

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const firebaseEnabled = !!(config.apiKey && config.projectId);

let authPromise: Promise<{ auth: Auth; m: typeof import("firebase/auth") }> | null = null;

function load() {
  authPromise ??= (async () => {
    const [{ initializeApp, getApps }, m] = await Promise.all([import("firebase/app"), import("firebase/auth")]);
    const app = getApps()[0] ?? initializeApp(config);
    const auth = m.getAuth(app);
    auth.languageCode = "tr";
    return { auth, m };
  })();
  return authPromise;
}

/** Warm the SDK up (e.g. when the dialog opens) so the Google popup opens inside the tap. */
export function preloadFirebase() {
  if (firebaseEnabled) void load();
}

export async function googleIdToken(): Promise<string> {
  const { auth, m } = await load();
  const cred = await m.signInWithPopup(auth, new m.GoogleAuthProvider());
  return cred.user.getIdToken();
}

const MAIL_KEY = "saygimdan-mail-link";

/** Sends the sign-in link. `nonce` lets this tab pick up the sign-in if the link opens elsewhere. */
export async function sendMailLink(email: string, nonce: string) {
  const { auth, m } = await load();
  const url = new URL("/", window.location.origin);
  url.searchParams.set("giris", "mail");
  url.searchParams.set("n", nonce);
  await m.sendSignInLinkToEmail(auth, email, { url: url.toString(), handleCodeInApp: true });
  try {
    localStorage.setItem(MAIL_KEY, email);
  } catch {}
}

export function isMailLink(href: string): boolean {
  return href.includes("giris=mail") && (href.includes("oobCode=") || href.includes("apiKey="));
}

/** The mail this device asked the link for (null: link opened on another device, ask for it). */
export function rememberedMail(): string | null {
  try {
    return localStorage.getItem(MAIL_KEY);
  } catch {
    return null;
  }
}

export async function finishMailLink(email: string, href: string): Promise<string> {
  const { auth, m } = await load();
  const cred = await m.signInWithEmailLink(auth, email, href);
  try {
    localStorage.removeItem(MAIL_KEY);
  } catch {}
  return cred.user.getIdToken();
}

/** Turkish text for Firebase's error codes the player can actually hit. */
export function firebaseErrorText(e: unknown): string {
  const code = (e as { code?: string })?.code ?? "";
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return "";
  if (code === "auth/popup-blocked") return "Tarayıcı açılır pencereyi engelledi. İzin verip tekrar dene ya da mail ile gir.";
  if (code === "auth/invalid-email") return "E-posta adresi hatalı görünüyor.";
  if (code === "auth/invalid-action-code" || code === "auth/expired-action-code")
    return "Bu giriş linkinin süresi dolmuş ya da kullanılmış. Yeni bir link iste.";
  if (code === "auth/network-request-failed") return "Bağlantı yok gibi, tekrar dene.";
  if (code === "auth/unauthorized-domain") return "Bu adres Firebase'de yetkili değil (Authorized domains).";
  if (code === "auth/operation-not-allowed") return "Bu giriş yöntemi Firebase'de açık değil.";
  return "Giriş yapılamadı, tekrar dene.";
}
