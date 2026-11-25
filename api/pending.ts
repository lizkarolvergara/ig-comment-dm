import { isLoggedIn, unauthorized } from "../lib/auth.js";
import { summarizePending } from "../lib/monitor.js";
import { supabaseStore } from "../lib/store.js";

// Monitoreo para el panel: comentarios que coincidieron con una regla pero no se completaron.
export async function GET(req: Request) {
  if (!isLoggedIn(req)) return unauthorized();
  const store = supabaseStore();
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const [events, keywords] = await Promise.all([store.unresolvedEvents(since), store.allKeywords()]);
  return Response.json({ groups: summarizePending(events, keywords) });
}

// Reintentar: POST /api/pending?comment=<id>. El lector lo vuelve a procesar en el próximo minuto.
export async function POST(req: Request) {
  if (!isLoggedIn(req)) return unauthorized();
  const id = new URL(req.url).searchParams.get("comment") ?? "";
  if (!/^\d+$/.test(id)) return Response.json({ error: "Comentario no válido" }, { status: 400 });
  const ok = await supabaseStore().resetEvent(id);
  if (!ok) return Response.json({ error: "Ese comentario ya está respondido o no existe." }, { status: 404 });
  return Response.json({ ok: true });
}
