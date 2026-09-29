import { getPlayer, issueToken, playerIdForFirebase, verifyFirebaseToken } from "@/lib/server/players";

/**
 * Google / mail sign-in finished on the client: signs in to the player of this
 * Firebase account, or asks for a name first (POST /api/users with the idToken).
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { idToken?: unknown } | null;
  const fb = typeof body?.idToken === "string" ? await verifyFirebaseToken(body.idToken) : null;
  if (!fb) return Response.json({ error: "Giriş doğrulanamadı, tekrar dene." }, { status: 401 });

  const id = await playerIdForFirebase(fb.uid);
  const player = id ? await getPlayer(id) : null;
  if (player) return Response.json({ player, token: await issueToken(player.id) });

  return Response.json({ needsName: true, suggestion: fb.displayName?.split(" ")[0] ?? "" });
}
