import { db } from "@/lib/server/db";
import { bearer, getPlayer, issueToken, playerIdFromToken } from "@/lib/server/players";

/*
 * Mail link sign-in often finishes somewhere else than where it started: the
 * link opens in Safari while the player waits in the home-screen app, or on
 * the phone while they wait on the computer. The waiting side made a nonce and
 * put it in the link; the side that finishes (signed in) parks a fresh device
 * token under it, and the waiting side picks it up once.
 */
const key = (nonce: string) => `handoff:${nonce}`;
const ok = (n: unknown): n is string => typeof n === "string" && /^[\w-]{16,64}$/.test(n);

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { nonce?: unknown } | null;
  if (!ok(body?.nonce)) return Response.json({ error: "bad nonce" }, { status: 400 });
  const id = await playerIdFromToken(bearer(req));
  if (!id) return Response.json({ error: "signed out" }, { status: 401 });
  await db().set(key(body.nonce), await issueToken(id), { ex: 15 * 60 });
  return Response.json({ ok: true });
}

export async function GET(req: Request) {
  const nonce = new URL(req.url).searchParams.get("n");
  if (!ok(nonce)) return Response.json({ error: "bad nonce" }, { status: 400 });
  const token = await db().getdel<string>(key(nonce));
  if (!token) return Response.json({ pending: true }, { headers: { "Cache-Control": "no-store" } });
  const id = await playerIdFromToken(token);
  const player = id ? await getPlayer(id) : null;
  if (!player) return Response.json({ pending: true }, { headers: { "Cache-Control": "no-store" } });
  return Response.json({ player, token }, { headers: { "Cache-Control": "no-store" } });
}
