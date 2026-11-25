import { isLoggedIn, unauthorized } from "../lib/auth.js";
import { loadDeps } from "../lib/context.js";

// Miniatura de un post para el panel: /api/thumb?media=<id>. Redirige a la URL fresca de Instagram.
export async function GET(req: Request) {
  if (!isLoggedIn(req)) return unauthorized();
  const media = new URL(req.url).searchParams.get("media") ?? "";
  if (!/^\d+$/.test(media)) return new Response("Bad request", { status: 400 });
  try {
    const url = await (await loadDeps()).ig.thumbnail(media);
    if (!url) return new Response(null, { status: 404 });
    // El navegador la guarda 1 hora; las URLs de Instagram duran más que eso.
    return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "private, max-age=3600" } });
  } catch {
    return new Response(null, { status: 404 });
  }
}
