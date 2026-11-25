import { GraphError, type IgApi } from "./instagram.js";
import { fillTemplate, pickKeyword, pickVariant } from "./match.js";
import type { Store } from "./store.js";

export interface IncomingComment {
  id: string;
  text: string;
  mediaId: string | null;
  fromId?: string;
  username?: string;
  createdAt?: string; // ISO
}

export interface Deps {
  store: Store;
  ig: IgApi;
  now?: () => Date;
}

export const MAX_ATTEMPTS = 6;
const SEVEN_DAYS_MS = 7 * 24 * 3600 * 1000;

export type Outcome = "self" | "duplicate" | "no-match" | "busy" | "done" | "fallback" | "partial" | "expired";

export async function processComment(c: IncomingComment, source: string, deps: Deps): Promise<Outcome> {
  const { store, ig } = deps;
  const now = deps.now?.() ?? new Date();
  const state = await store.getState();

  // 1. Ignorar mis propios comentarios (incluidas mis respuestas públicas) para no entrar en bucle.
  if ((c.fromId && c.fromId === state.ig_user_id) || (c.username && c.username === state.ig_username)) return "self";

  // 2. Registrar el comentario (idempotente por comment_id).
  const kw = pickKeyword(c.text, c.mediaId, await store.activeKeywords());
  const isNew = await store.insertEvent({
    comment_id: c.id,
    media_id: c.mediaId,
    ig_user_id: c.fromId ?? null,
    username: c.username ?? null,
    text: c.text,
    comment_created_at: c.createdAt ?? now.toISOString(),
    source,
    matched: !!kw,
    keyword_id: kw?.id ?? null,
  });
  if (!kw && isNew) return "no-match";

  // 3. Reservarlo: si otro proceso lo tiene o ya está completo, salir.
  const ev = await store.claim(c.id);
  if (!ev) return isNew ? "busy" : "duplicate";
  if (ev.attempts > MAX_ATTEMPTS) {
    await store.updateEvent(c.id, { locked_until: null });
    return "partial";
  }
  // Usar la palabra clave guardada en el evento (por si cambió la configuración).
  const keyword =
    (await store.activeKeywords()).find((k) => k.id === ev.keyword_id) ?? kw;
  if (!keyword) {
    await store.updateEvent(c.id, { error: "La palabra clave ya no está activa", locked_until: null });
    return "partial";
  }

  const errors: string[] = [];
  const created = new Date(ev.comment_created_at ?? now.toISOString()).getTime();
  const lastAttempt = ev.attempts >= MAX_ATTEMPTS;

  // 4. DM (private reply) primero: según el resultado elegimos la respuesta pública.
  if (!ev.dm_sent && !ev.dm_undeliverable) {
    let undeliverable: string | null = null;
    if (now.getTime() - created > SEVEN_DAYS_MS) {
      undeliverable = "DM: el comentario tiene más de 7 días, Meta ya no permite private reply";
    } else if (!state.ig_user_id) {
      errors.push("DM: falta ig_user_id en app_state");
    } else {
      try {
        const r = await ig.sendPrivateReply(state.ig_user_id, c.id, fillTemplate(keyword.dm_message, ev.username ?? c.username));
        ev.dm_sent = true;
        await store.updateEvent(c.id, { dm_sent: true, dm_sent_at: now.toISOString(), dm_message_id: r.message_id });
      } catch (e) {
        const msg = `DM: ${(e as Error).message}`;
        if (isUndeliverable(e)) undeliverable = msg;
        else if (lastAttempt) undeliverable = `${msg} (último intento)`;
        else errors.push(msg); // transitorio o desconocido: se reintenta, sin responder en público todavía
      }
    }
    if (undeliverable) {
      ev.dm_undeliverable = true;
      errors.push(undeliverable);
      await store.updateEvent(c.id, { dm_undeliverable: true });
    }
  }

  // 5. Respuesta pública: la normal si llegó el DM, la alternativa ("escríbeme primero") si no se puede entregar.
  if (!ev.replied && (ev.dm_sent || ev.dm_undeliverable)) {
    const text = ev.dm_sent ? keyword.public_reply : keyword.fallback_reply || DEFAULT_FALLBACK_REPLY;
    try {
      const r = await ig.replyToComment(c.id, fillTemplate(pickVariant(text), ev.username ?? c.username));
      ev.replied = true;
      await store.updateEvent(c.id, { replied: true, replied_at: now.toISOString(), reply_id: r.id });
    } catch (e) {
      errors.push(`Respuesta pública: ${(e as Error).message}`);
    }
  }

  await store.updateEvent(c.id, { error: errors.length ? errors.join(" · ") : null, locked_until: null });
  if (errors.some((e) => e.includes("más de 7 días"))) return "expired";
  if (ev.dm_undeliverable && ev.replied) return "fallback";
  return ev.dm_sent && ev.replied ? "done" : "partial";
}

export const DEFAULT_FALLBACK_REPLY =
  "{usuario} ¡No pude enviarte el mensaje! 😢 Escríbeme por DM y te lo paso. | {usuario} No me deja enviarte el DM 🙈 Escríbeme primero y te lo mando.";

/**
 * Errores de Meta que significan "a esta persona no se le puede entregar el DM" (no se reintentan).
 * 551: persona no disponible. 10: fuera de la ventana permitida / sin permiso para escribirle.
 * 100 con estos subcódigos: usuario no encontrado.
 * OJO: confirmar con errores reales; el registro guarda código y subcódigo para ajustarlo.
 */
export function isUndeliverable(e: unknown): boolean {
  if (!(e instanceof GraphError) || e.transient) return false;
  if (e.code === 551 || e.code === 10) return true;
  if (e.code === 100 && [2018001, 2534014, 2018109].includes(e.subcode ?? -1)) return true;
  return false;
}
