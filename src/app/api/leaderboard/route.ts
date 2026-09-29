import { db, k } from "@/lib/server/db";
import { Board, BoardResponse, BoardRow, isGameSlug } from "@/lib/scores";
import { bearer, playerIdFromToken } from "@/lib/server/players";

/** Top N of a board (game or "all") + the caller's own rank when signed in. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const g = url.searchParams.get("game") ?? "all";
  const board: Board | null = g === "all" || isGameSlug(g) ? g : null;
  if (!board) return Response.json({ error: "bad game" }, { status: 400 });
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 50));

  const r = db();
  const key = k.lb(board);
  const [flat, total] = await Promise.all([
    r.zrange<(string | number)[]>(key, 0, limit - 1, { rev: true, withScores: true }),
    r.zcard(key),
  ]);
  const ids: string[] = [];
  const scores: number[] = [];
  for (let i = 0; i < flat.length; i += 2) {
    ids.push(String(flat[i]));
    scores.push(Number(flat[i + 1]));
  }
  const names = ids.length ? await namesOf(ids) : [];
  const rows: BoardRow[] = [];
  ids.forEach((_, i) => {
    // equal scores share a rank
    const rank = i > 0 && scores[i] === scores[i - 1] ? rows[i - 1].rank : i + 1;
    rows.push({ rank, name: names[i] ?? "?", score: scores[i] });
  });
  const out: BoardResponse = { board, rows, total };

  const me = await playerIdFromToken(bearer(req));
  if (me) {
    const score = await r.zscore(key, me);
    // rank = players with a strictly higher score + 1
    const above = score == null ? null : await r.zcount(key, `(${score}`, "+inf");
    out.me = { rank: above == null ? null : above + 1, score: Number(score ?? 0) };
  }

  return Response.json(out, {
    headers: { "Cache-Control": me ? "private, no-store" : "public, s-maxage=10, stale-while-revalidate=30" },
  });
}

async function namesOf(ids: string[]): Promise<(string | null)[]> {
  const p = db().pipeline();
  for (const id of ids) p.hget(k.user(id), "name");
  return ((await p.exec()) as unknown[]).map((n) => (n == null ? null : String(n)));
}
