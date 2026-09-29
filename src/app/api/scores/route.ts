import { GAMES, type GameSlug } from "@/lib/games";
import { getDb } from "@/lib/server/db";
import { json, sessionPlayer, withDb } from "@/lib/server/auth";

/** Above this a score is not from a real run. */
const MAX_SCORE = 50_000_000;

/** Report a run's score: { game, score } → { best, improved, rank, total } (the stored best only ever goes up). */
export async function POST(req: Request) {
  return withDb(async () => {
    const key = await sessionPlayer(req);
    if (!key) return json({ error: "unauthorized" }, 401);
    const body = (await req.json().catch(() => null)) as { game?: unknown; score?: unknown } | null;
    const game = GAMES.find((g) => g.slug === body?.game)?.slug as GameSlug | undefined;
    const score = typeof body?.score === "number" ? Math.floor(body.score) : NaN;
    if (!game) return json({ error: "bad_game" }, 400);
    if (!Number.isFinite(score) || score <= 0 || score > MAX_SCORE) return json({ error: "bad_score" }, 400);

    const db = getDb();
    if ((await db.hit(`score:${key}`, 60)) > 30) return json({ error: "rate_limited" }, 429);
    const { best, improved } = await db.submit(game, key, score);
    const page = await db.board(game, 1, key);
    return json({ best, improved, rank: page.me?.rank ?? null, total: page.total });
  });
}
