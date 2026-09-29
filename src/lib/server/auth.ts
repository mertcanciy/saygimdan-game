import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { DbUnavailableError, getDb } from "./db";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(pin, salt, 32);
  return `${salt.toString("base64url")}.${hash.toString("base64url")}`;
}

export async function checkPin(pin: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(".");
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const got = await scrypt(pin, Buffer.from(salt, "base64url"), expected.length);
  return timingSafeEqual(got, expected);
}

export function newToken(): string {
  return randomBytes(24).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

/** The player behind `Authorization: Bearer <token>`, or null. */
export async function sessionPlayer(req: Request): Promise<string | null> {
  const m = /^Bearer (\S{16,128})$/.exec(req.headers.get("authorization") ?? "");
  if (!m) return null;
  return getDb().playerForToken(hashToken(m[1]));
}

export function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "local";
}

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** 503 when the database isn't configured / reachable, so the client can fall back to guest play. */
export async function withDb(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof DbUnavailableError) {
      console.error("[db]", e.message);
      return json({ error: "db_unavailable" }, 503);
    }
    throw e;
  }
}
