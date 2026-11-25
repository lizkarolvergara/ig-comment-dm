import { createIgApi } from "./instagram.js";
import { supabaseStore, type Store } from "./store.js";
import type { Deps } from "./process.js";

/** Crea store + cliente de Instagram con el token guardado en Supabase. */
export async function loadDeps(store: Store = supabaseStore()): Promise<Deps> {
  const state = await store.getState();
  if (!state.access_token) throw new Error("No hay access_token en app_state. Ejecuta npm run set-token.");
  const token = state.access_token;
  return { store, ig: createIgApi(() => token) };
}

/** Comprueba "Authorization: Bearer <CRON_SECRET>" (formato que usa Vercel Cron). */
export function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  return !!secret && req.headers.get("authorization") === `Bearer ${secret}`;
}
