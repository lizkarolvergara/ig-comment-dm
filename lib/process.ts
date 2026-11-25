import type { IgApi } from "./instagram.js";
import { pickKeyword, pickVariant } from "./match.js";
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

export type Outcome = "self" | "duplicate" | "no-match" | "busy" | "done" | "partial" | "expired";

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

  // 4. DM (private reply): lo más importante, va primero.
  if (!ev.dm_sent) {
    if (now.getTime() - created > SEVEN_DAYS_MS) {
      errors.push("DM: el comentario tiene más de 7 días, Meta ya no permite private reply");
    } else if (!state.ig_user_id) {
      errors.push("DM: falta ig_user_id en app_state");
    } else {
      try {
        const r = await ig.sendPrivateReply(state.ig_user_id, c.id, keyword.dm_message);
        ev.dm_sent = true;
        await store.updateEvent(c.id, { dm_sent: true, dm_sent_at: now.toISOString(), dm_message_id: r.message_id });
      } catch (e) {
        errors.push(`DM: ${(e as Error).message}`);
      }
    }
  }

  // 5. Respuesta pública.
  if (!ev.replied) {
    try {
      const r = await ig.replyToComment(c.id, pickVariant(keyword.public_reply));
      ev.replied = true;
      await store.updateEvent(c.id, { replied: true, replied_at: now.toISOString(), reply_id: r.id });
    } catch (e) {
      errors.push(`Respuesta pública: ${(e as Error).message}`);
    }
  }

  await store.updateEvent(c.id, { error: errors.length ? errors.join(" · ") : null, locked_until: null });
  if (errors.some((e) => e.includes("más de 7 días"))) return "expired";
  return ev.dm_sent && ev.replied ? "done" : "partial";
}
