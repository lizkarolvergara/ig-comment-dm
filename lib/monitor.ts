import type { Keyword } from "./match.js";
import { MAX_ATTEMPTS } from "./process.js";
import type { EventRow } from "./store.js";

const DAY_MS = 24 * 3600 * 1000;

export type PendingStatus = "en-curso" | "reintentando" | "fallo" | "vencido" | "sin-dm";

export interface PendingItem {
  comment_id: string;
  username: string | null;
  text: string | null;
  at: string;
  status: PendingStatus;
  reason: string;
  /** Horas que quedan de la ventana de 7 días de Meta para el DM (0 si ya venció). */
  hoursLeft: number;
  canRetry: boolean;
}

export interface PendingGroup {
  media_id: string | null;
  post_url: string | null;
  keyword: string | null;
  items: PendingItem[];
}

/**
 * Comentarios que coincidieron con una regla pero no se completaron:
 * - sin respuesta pública todavía (en curso, reintentando, fallo definitivo o ventana vencida),
 * - o con respuesta alternativa porque el DM no llegó (solo los de la última semana, a modo de aviso).
 * Agrupados por post, los más urgentes primero.
 */
export function summarizePending(events: EventRow[], keywords: Keyword[], now = new Date()): PendingGroup[] {
  const byId = new Map(keywords.map((k) => [k.id, k]));
  const groups = new Map<string, PendingGroup>();

  for (const e of events) {
    if (!e.matched || (e.replied && e.dm_sent)) continue;
    const at = e.comment_created_at ?? e.created_at ?? now.toISOString();
    const age = now.getTime() - new Date(at).getTime();
    const hoursLeft = Math.max(0, Math.floor((7 * DAY_MS - age) / 3600000));
    const kw = e.keyword_id != null ? byId.get(e.keyword_id) : undefined;

    let status: PendingStatus;
    if (e.replied) {
      if (age > 7 * DAY_MS) continue; // aviso viejo de "sin DM": ya no interesa
      status = "sin-dm";
    } else if (hoursLeft === 0) status = "vencido";
    else if (e.attempts >= MAX_ATTEMPTS) status = "fallo";
    else if (e.error) status = "reintentando";
    else status = "en-curso";

    const reason =
      status === "sin-dm" ? `No se pudo enviar el DM; se respondió pidiendo que te escriba. ${e.error ?? ""}`.trim()
      : status === "vencido" ? "Pasaron más de 7 días: Meta ya no permite enviarle el DM."
      : status === "en-curso" ? "Recién llegó; el bot lo está procesando."
      : !e.dm_sent && !e.dm_undeliverable ? `Falta el DM. ${e.error ?? ""}`.trim()
      : `Falta la respuesta pública. ${e.error ?? ""}`.trim();

    const canRetry = (status === "fallo" || status === "reintentando") && !!kw?.active;
    const key = e.media_id ?? "?";
    if (!groups.has(key)) {
      groups.set(key, { media_id: e.media_id, post_url: kw?.post_url ?? null, keyword: kw?.keyword.split(",")[0].trim() ?? null, items: [] });
    }
    groups.get(key)!.items.push({ comment_id: e.comment_id, username: e.username, text: e.text, at, status, reason, hoursLeft, canRetry });
  }

  const rank: Record<PendingStatus, number> = { fallo: 0, reintentando: 1, "en-curso": 2, "sin-dm": 3, vencido: 4 };
  const list = [...groups.values()];
  for (const g of list) g.items.sort((a, b) => rank[a.status] - rank[b.status] || a.hoursLeft - b.hoursLeft);
  list.sort((a, b) => rank[a.items[0].status] - rank[b.items[0].status]);
  return list;
}
