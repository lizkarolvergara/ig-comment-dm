import { alert } from "./alert.js";
import { createIgApi } from "./instagram.js";
import type { Store } from "./store.js";

const DAY = 24 * 3600 * 1000;

/** Renueva el token si vence en menos de 20 días. Meta exige que tenga al menos 24 h. */
export async function refreshIfNeeded(store: Store, now = new Date(), fetchImpl?: typeof fetch) {
  const s = await store.getState();
  if (!s.access_token || !s.token_expires_at) {
    await alert("No hay token guardado. Ejecuta npm run set-token.");
    return { refreshed: false, reason: "sin token" };
  }
  const daysLeft = (new Date(s.token_expires_at).getTime() - now.getTime()) / DAY;
  const age = s.token_refreshed_at ? now.getTime() - new Date(s.token_refreshed_at).getTime() : Infinity;
  if (daysLeft > 20 || age < DAY) return { refreshed: false, daysLeft: Math.floor(daysLeft) };

  try {
    const token = s.access_token;
    const r = await createIgApi(() => token, { fetchImpl }).refreshToken();
    await store.updateState({
      access_token: r.access_token,
      token_expires_at: new Date(now.getTime() + r.expires_in * 1000).toISOString(),
      token_refreshed_at: now.toISOString(),
      last_refresh_error: null,
    });
    return { refreshed: true, daysLeft: Math.floor(r.expires_in / 86400) };
  } catch (e) {
    const msg = (e as Error).message;
    await store.updateState({ last_refresh_error: msg });
    await alert(`No se pudo renovar el token (quedan ${Math.floor(daysLeft)} días): ${msg}`);
    return { refreshed: false, daysLeft: Math.floor(daysLeft), error: msg };
  }
}
