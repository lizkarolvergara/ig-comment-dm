import { createIgApi, isInstagramLogin } from "./instagram.js";
import { supabaseStore, type Store } from "./store.js";
import type { Deps } from "./process.js";

/**
 * Crea store + cliente de la API.
 * - Unified login (por defecto): token de usuario del sistema que no caduca, leído de IG_ACCESS_TOKEN. No se guarda en la base.
 * - Instagram Login: token de 60 días; la primera vez se copia de IG_ACCESS_TOKEN a app_state y desde ahí se renueva.
 * En ambos casos guarda en app_state el id y el usuario de la cuenta (sirve para ignorar tus propios comentarios).
 */
export async function loadDeps(store: Store = supabaseStore()): Promise<Deps> {
  let state = await store.getState();
  const envToken = process.env.IG_ACCESS_TOKEN;

  let token: string;
  if (isInstagramLogin()) {
    token = state.access_token ?? envToken ?? "";
    if (!token) throw new Error("No hay token: define IG_ACCESS_TOKEN en Vercel.");
    if (!state.access_token) {
      const now = Date.now();
      await store.updateState({
        access_token: token,
        token_expires_at: new Date(now + 60 * 86400 * 1000).toISOString(),
        token_refreshed_at: new Date(now).toISOString(),
      });
    }
  } else {
    if (!envToken) throw new Error("Falta IG_ACCESS_TOKEN en las variables de entorno.");
    token = envToken;
  }

  const ig = createIgApi(() => token);
  const wantedId = process.env.IG_USER_ID ?? state.ig_user_id ?? undefined;
  if (!state.ig_user_id || !state.ig_username || (process.env.IG_USER_ID && process.env.IG_USER_ID !== state.ig_user_id)) {
    const acc = await ig.account(wantedId);
    await store.updateState({ ig_user_id: acc.id, ig_username: acc.username });
    state = await store.getState();
  }
  return { store, ig };
}

/** Comprueba "Authorization: Bearer <CRON_SECRET>" (formato que usa Vercel Cron). */
export function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  return !!secret && req.headers.get("authorization") === `Bearer ${secret}`;
}
