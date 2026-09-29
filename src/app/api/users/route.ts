import { checkName, checkPassword } from "@/lib/scores";
import {
  createPlayer,
  getPlayer,
  issueToken,
  playerIdForFirebase,
  playerIdForName,
  verifyFirebaseToken,
} from "@/lib/server/players";

/**
 * Is this name taken, and how does its owner sign in? The dialog asks while
 * the name is typed, to show "şifreni gir" or "şifre belirle".
 */
export async function GET(req: Request) {
  const checked = checkName(new URL(req.url).searchParams.get("name") ?? "");
  if ("error" in checked) return Response.json({ error: checked.error }, { status: 400 });
  const id = await playerIdForName(checked.name);
  const player = id ? await getPlayer(id) : null;
  return Response.json({ exists: !!player, via: player?.via }, { headers: { "Cache-Control": "no-store" } });
}

/** New player: name + password, or a name for a Firebase account that has none yet. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { name?: unknown; password?: unknown; idToken?: unknown } | null;
  const checked = checkName(typeof body?.name === "string" ? body.name : "");
  if ("error" in checked) return Response.json({ error: checked.error, field: "name" }, { status: 400 });

  let player;
  if (typeof body?.idToken === "string") {
    const fb = await verifyFirebaseToken(body.idToken);
    if (!fb) return Response.json({ error: "Giriş süresi doldu, tekrar dene." }, { status: 401 });
    if (await playerIdForFirebase(fb.uid))
      return Response.json({ error: "Bu hesap zaten açılmış, tekrar giriş yap." }, { status: 409 });
    player = await createPlayer(checked.name, { fbUid: fb.uid, via: fb.via });
  } else {
    const password = typeof body?.password === "string" ? body.password : "";
    const bad = checkPassword(password);
    if (bad) return Response.json({ error: bad, field: "password" }, { status: 400 });
    player = await createPlayer(checked.name, { password });
  }

  if (!player)
    return Response.json({ error: "Bu kullanıcı adı alınmış, başka bir tane dene.", field: "name" }, { status: 409 });
  return Response.json({ player, token: await issueToken(player.id) });
}
