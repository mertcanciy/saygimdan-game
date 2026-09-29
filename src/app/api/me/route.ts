import { bearer, getPlayer, playerIdFromToken } from "@/lib/server/players";

/** Who this device token belongs to (null: signed out on the server, e.g. merged away). */
export async function GET(req: Request) {
  const id = await playerIdFromToken(bearer(req));
  const player = id ? await getPlayer(id) : null;
  return Response.json({ player }, { status: player ? 200 : 401 });
}
