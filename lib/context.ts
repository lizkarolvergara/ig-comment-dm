import { createIgApi } from "./instagram.js";
import { supabaseStore, type Store } from "./store.js";
import type { Deps } from "./process.js";

/**
 * Crea store + cliente de Instagram con el token guardado en Supabase.
 * Primera vez: si app_state no tiene token, toma IG_ACCESS_TOKEN de las variables de entorno y lo guarda.
 */
export async function loadDeps(store: Store = supabaseStore()): Promise<Deps> {
  let state = await store.getState();
  if (!state.access_token) {
    const envToken = process.env.IG_ACCESS_TOKEN;
    if (!envToken) throw new Error("No hay token: define IG_ACCESS_TOKEN en Vercel o ejecuta npm run set-token.");
    const me = await createIgApi(() => envToken).me();
    const now = Date.now();
    await store.updateState({
      ig_user_id: me.user_id,
      ig_username: me.username,
      access_token: envToken,
      token_expires_at: new Date(now + 60 * 86400 * 1000).toISOString(),
      token_refreshed_at: new Date(now).toISOString(),
    });
    state = await store.getState();
  }
  const token = state.access_token!;
  return { store, ig: createIgApi(() => token) };
}

/** Comprueba "Authorization: Bearer <CRON_SECRET>" (formato que usa Vercel Cron). */
export function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  return !!secret && req.headers.get("authorization") === `Bearer ${secret}`;
}
