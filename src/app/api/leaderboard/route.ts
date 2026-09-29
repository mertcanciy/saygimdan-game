import { isBoard, type BoardEntry, type BoardResponse } from "@/lib/leaderboard";
import { getDb } from "@/lib/server/db";
import { json, sessionPlayer, withDb } from "@/lib/server/auth";

/** GET ?board=all|<slug>&limit=50 (optional Bearer token adds the player's own row). */
export async function GET(req: Request) {
  return withDb(async () => {
    const params = new URL(req.url).searchParams;
    const board = params.get("board") ?? "all";
    if (!isBoard(board)) return json({ error: "bad_board" }, 400);
    const limit = Math.min(100, Math.max(1, Number(params.get("limit")) || 50));

    const db = getDb();
    const me = await sessionPlayer(req);
    const page = await db.board(board, limit, me);
    const names = await db.names([...page.top.map((r) => r.key), ...(me && page.me ? [me] : [])]);
    const entries: BoardEntry[] = page.top.map((r, i) => ({ rank: i + 1, name: names.get(r.key) ?? r.key, score: Math.round(r.score) }));
    const res: BoardResponse = {
      board,
      entries,
      total: page.total,
      me: me && page.me ? { rank: page.me.rank, name: names.get(me) ?? me, score: Math.round(page.me.score) } : null,
    };
    return json(res);
  });
}
