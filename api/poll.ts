import { alert } from "../lib/alert.js";
import { isAuthorized, loadDeps } from "../lib/context.js";
import { pollRecent } from "../lib/poll.js";
import { supabaseStore } from "../lib/store.js";

// Lo llama pg_cron (Supabase) cada minuto. También sirve para reprocesar fallidos.
export async function GET(req: Request) {
  if (!isAuthorized(req)) return new Response("Unauthorized", { status: 401 });
  const store = supabaseStore();
  const prev = await store.getState();
  try {
    const results = await pollRecent(await loadDeps(store));
    await store.updateState({ last_poll_at: new Date().toISOString(), last_poll_error: null });
    return Response.json({ ok: true, results });
  } catch (e) {
    const msg = (e as Error).message;
    await store.updateState({ last_poll_at: new Date().toISOString(), last_poll_error: msg });
    if (!prev.last_poll_error) await alert(`El lector de comentarios falló: ${msg}`); // avisar solo al empezar a fallar
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}
