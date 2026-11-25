import type { IncomingComment } from "./process.js";

/** Extrae los comentarios del payload de webhooks de Instagram (campo "comments"). */
export function parseCommentsPayload(payload: any): IncomingComment[] {
  if (payload?.object !== "instagram") return [];
  const out: IncomingComment[] = [];
  for (const entry of payload.entry ?? []) {
    for (const ch of entry.changes ?? []) {
      if (ch.field !== "comments" || !ch.value?.id) continue;
      const v = ch.value;
      out.push({
        id: String(v.id),
        text: v.text ?? "",
        mediaId: v.media?.id ? String(v.media.id) : null,
        fromId: v.from?.id ? String(v.from.id) : undefined,
        username: v.from?.username,
        createdAt: entry.time ? new Date(entry.time * (entry.time < 1e12 ? 1000 : 1)).toISOString() : undefined,
      });
    }
  }
  return out;
}
