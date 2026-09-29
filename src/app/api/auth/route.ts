import { NAME_RE, PIN_RE, cleanName, nameKey } from "@/lib/leaderboard";
import { getDb } from "@/lib/server/db";
import { checkPin, clientIp, hashPin, hashToken, json, newToken, withDb } from "@/lib/server/auth";

/** Is a username free? → { available } */
export async function GET(req: Request) {
  return withDb(async () => {
    const name = cleanName(new URL(req.url).searchParams.get("name") ?? "");
    if (!NAME_RE.test(name)) return json({ error: "bad_name" }, 400);
    const db = getDb();
    if ((await db.hit(`check:${clientIp(req)}`, 60)) > 120) return json({ error: "rate_limited" }, 429);
    return json({ available: !(await db.getPlayer(nameKey(name))) });
  });
}

/**
 * Sign in or sign up with username + 4-digit PIN.
 * Free name → account created. Taken name → PIN must match.
 * → { token, name, created }
 */
export async function POST(req: Request) {
  return withDb(async () => {
    const body = (await req.json().catch(() => null)) as { name?: unknown; pin?: unknown } | null;
    const name = cleanName(typeof body?.name === "string" ? body.name : "");
    const pin = typeof body?.pin === "string" ? body.pin : "";
    if (!NAME_RE.test(name)) return json({ error: "bad_name" }, 400);
    if (!PIN_RE.test(pin)) return json({ error: "bad_pin" }, 400);

    const db = getDb();
    const key = nameKey(name);
    if ((await db.hit(`auth:${clientIp(req)}`, 600)) > 40) return json({ error: "rate_limited" }, 429);

    let created = false;
    let player = await db.getPlayer(key);
    if (!player) {
      const rec = { name, pinHash: await hashPin(pin), createdAt: Date.now() };
      created = await db.createPlayer(key, rec);
      player = created ? rec : await db.getPlayer(key);
    }
    if (!player) return json({ error: "try_again" }, 409);
    if (!created) {
      // a 4-digit PIN is only as strong as the attempt limit on it
      if ((await db.hit(`pin:${key}`, 900)) > 8) return json({ error: "rate_limited" }, 429);
      if (!(await checkPin(pin, player.pinHash))) return json({ error: "wrong_pin" }, 401);
    }

    const token = newToken();
    await db.setToken(hashToken(token), key);
    return json({ token, name: player.name, created });
  });
}
