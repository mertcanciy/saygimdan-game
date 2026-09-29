import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { db, k } from "./db";
import { nameKey } from "@/lib/scores";

/** How the player signs in: name + password, or a Firebase account (Google / mail link). */
export type Via = "password" | "google" | "mail";

export interface Player {
  id: string;
  name: string;
  via: Via;
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** A fresh device token for `id`: the client keeps the token, the server only its hash. */
export async function issueToken(id: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db().set(k.tok(hashToken(token)), id);
  return token;
}

export function bearer(req: Request): string | null {
  const h = req.headers.get("authorization");
  return h?.startsWith("Bearer ") ? h.slice(7).trim() || null : null;
}

export async function playerIdFromToken(token: string | null): Promise<string | null> {
  if (!token) return null;
  return db().get<string>(k.tok(hashToken(token)));
}

/** HGETALL without automatic deserialization comes back as a flat [field, value, …] list. */
function hashObject(raw: unknown): Record<string, string> {
  if (!raw) return {};
  if (!Array.isArray(raw)) return raw as Record<string, string>;
  const o: Record<string, string> = {};
  for (let i = 0; i + 1 < raw.length; i += 2) o[String(raw[i])] = String(raw[i + 1]);
  return o;
}

export async function getPlayer(id: string): Promise<Player | null> {
  const u = hashObject(await db().hgetall(k.user(id)));
  return u.name ? { id, name: u.name, via: u.via as Via } : null;
}

export async function playerIdForName(name: string): Promise<string | null> {
  return db().get<string>(k.name(nameKey(name)));
}

/** Claims `name` and creates the player; null when the name is taken. */
export async function createPlayer(
  name: string,
  cred: { password: string } | { fbUid: string; via: "google" | "mail" }
): Promise<Player | null> {
  const id = randomBytes(9).toString("base64url");
  const claimed = await db().set(k.name(nameKey(name)), id, { nx: true });
  if (claimed !== "OK") return null;
  const via: Via = "password" in cred ? "password" : cred.via;
  await db().hset(k.user(id), {
    name,
    via,
    createdAt: Date.now(),
    ...("password" in cred ? { pw: await hashPassword(cred.password) } : { fb: cred.fbUid }),
  });
  if ("fbUid" in cred) await db().set(k.fb(cred.fbUid), id);
  return { id, name, via };
}

export async function playerIdForFirebase(fbUid: string): Promise<string | null> {
  return db().get<string>(k.fb(fbUid));
}

/* ------------------------------------------------------------------ */
/* Passwords: scrypt with a per-player salt, stored as "scrypt$salt$hash". */

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password.normalize("NFC"), salt, 32);
  return `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [algo, salt, hash] = stored.split("$");
  if (algo !== "scrypt" || !salt || !hash) return false;
  const want = Buffer.from(hash, "base64url");
  const got = await scryptAsync(password.normalize("NFC"), Buffer.from(salt, "base64url"), want.length);
  return timingSafeEqual(got, want);
}

const MAX_FAILS = 10;
const FAIL_WINDOW_SEC = 15 * 60;

export type LoginResult =
  | { ok: true; player: Player }
  | { ok: false; reason: "unknown" | "firebase" | "wrong" | "locked"; via?: Via };

/** Name + password sign-in; too many wrong passwords lock the name for a while. */
export async function checkLogin(name: string, password: string): Promise<LoginResult> {
  const id = await playerIdForName(name);
  if (!id) return { ok: false, reason: "unknown" };
  const u = hashObject(await db().hgetall(k.user(id)));
  if (!u.pw) return { ok: false, reason: "firebase", via: u.via as Via };

  const failKey = k.fail(nameKey(name));
  const fails = Number((await db().get<string>(failKey)) ?? 0);
  if (fails >= MAX_FAILS) return { ok: false, reason: "locked" };
  if (!(await passwordMatches(password, u.pw))) {
    const p = db().pipeline();
    p.incr(failKey);
    p.expire(failKey, FAIL_WINDOW_SEC);
    await p.exec();
    return { ok: false, reason: "wrong" };
  }
  if (fails) await db().del(failKey);
  return { ok: true, player: { id, name: u.name, via: u.via as Via } };
}

/* ------------------------------------------------------------------ */
/* Firebase ID tokens: checked against Google's public keys, no service account. */

const JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com")
);

export interface FirebaseIdentity {
  uid: string;
  via: "google" | "mail";
  displayName?: string;
}

export async function verifyFirebaseToken(idToken: string): Promise<FirebaseIdentity | null> {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId) return null; // Firebase not set up: Google / mail sign-in is hidden anyway
  try {
    const { payload } = await jwtVerify(idToken, JWKS, {
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
    });
    if (!payload.sub) return null;
    const provider = (payload.firebase as { sign_in_provider?: string } | undefined)?.sign_in_provider;
    return {
      uid: payload.sub,
      via: provider === "google.com" ? "google" : "mail",
      displayName: typeof payload.name === "string" ? payload.name : undefined,
    };
  } catch {
    return null;
  }
}
