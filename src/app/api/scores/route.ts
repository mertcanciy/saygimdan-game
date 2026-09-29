import { db, k } from "@/lib/server/db";
import { MAX_POINTS_PER_SEC, POINTS_BURST, isGameSlug } from "@/lib/scores";
import { bearer, playerIdFromToken } from "@/lib/server/players";

const MAX_CHUNK_SEC = 60 * 60;

/**
 * Points earned since the last report, added to the game's and the overall
 * total. Sent on pause / leaving the game (sendBeacon can't set headers, so the
 * token may come in the body).
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | { game?: unknown; points?: unknown; seconds?: unknown; token?: unknown }
    | null;
  const game = body?.game;
  if (!isGameSlug(game)) return Response.json({ error: "bad game" }, { status: 400 });
  const token = bearer(req) ?? (typeof body?.token === "string" ? body.token : null);
  const id = await playerIdFromToken(token);
  if (!id) return Response.json({ error: "signed out" }, { status: 401 });

  const points = Math.floor(Number(body?.points));
  let seconds = Number(body?.seconds);
  if (!(points > 0) || !(seconds > 0)) return Response.json({ added: 0 });

  // time played can't exceed the time since the last report
  const r = db();
  const now = Date.now();
  const last = await r.get<number>(k.last(id, game));
  if (last) seconds = Math.min(seconds, (now - Number(last)) / 1000 + 5);
  seconds = Math.min(seconds, MAX_CHUNK_SEC);
  const added = Math.max(0, Math.min(points, Math.round(MAX_POINTS_PER_SEC[game] * seconds + POINTS_BURST)));

  const p = r.pipeline();
  p.set(k.last(id, game), now, { ex: 60 * 60 * 24 });
  if (added > 0) {
    p.zincrby(k.lb(game), added, id);
    p.zincrby(k.lb("all"), added, id);
  }
  const res = await p.exec();
  return Response.json({ added, total: added > 0 ? Number(res[1]) : undefined });
}
