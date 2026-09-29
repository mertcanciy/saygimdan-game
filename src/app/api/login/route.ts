import { checkName } from "@/lib/scores";
import { checkLogin, issueToken } from "@/lib/server/players";

/** Name + password sign-in (any device). */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { name?: unknown; password?: unknown } | null;
  const checked = checkName(typeof body?.name === "string" ? body.name : "");
  const password = typeof body?.password === "string" ? body.password : "";
  if ("error" in checked || !password)
    return Response.json({ error: "Kullanıcı adı ya da şifre yanlış.", field: "password" }, { status: 401 });

  const r = await checkLogin(checked.name, password);
  if (r.ok) return Response.json({ player: r.player, token: await issueToken(r.player.id) });

  const error =
    r.reason === "unknown"
      ? { error: "Bu adla bir hesap yok.", field: "name" }
      : r.reason === "firebase"
        ? { error: `Bu hesap ${r.via === "google" ? "Google" : "mail"} ile açılmış, aşağıdan giriş yap.`, field: "name" }
        : r.reason === "locked"
          ? { error: "Çok fazla yanlış deneme. 15 dakika sonra tekrar dene.", field: "password" }
          : { error: "Şifre yanlış.", field: "password" };
  return Response.json(error, { status: r.reason === "locked" ? 429 : 401 });
}
