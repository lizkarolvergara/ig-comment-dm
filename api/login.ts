import { checkPassword, clearCookie, sessionCookie } from "../lib/auth.js";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { password?: string };
  if (!checkPassword(String(body.password ?? ""))) {
    await new Promise((r) => setTimeout(r, 1000)); // frena intentos por fuerza bruta
    return Response.json({ error: "Contraseña incorrecta" }, { status: 401 });
  }
  return Response.json({ ok: true }, { headers: { "Set-Cookie": sessionCookie() } });
}

export function DELETE() {
  return Response.json({ ok: true }, { headers: { "Set-Cookie": clearCookie() } });
}
