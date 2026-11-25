import type { IgComment, MediaSummary } from "./instagram.js";
import { isGlobal, shortcodeFromUrl, type Keyword } from "./match.js";
import { MAX_ATTEMPTS, processComment, type Deps, type Outcome } from "./process.js";

const SEVEN_DAYS_MS = 7 * 24 * 3600 * 1000;
/** Cada cuánto releer un post aunque su número de comentarios no haya cambiado (por si se borró uno y llegó otro). */
const FULL_RESCAN_MS = 15 * 60 * 1000;

function flatten(comments: IgComment[]): IgComment[] {
  return comments.flatMap((c) => [c, ...(c.replies?.data ?? [])]);
}

/**
 * Revisa los comentarios de un post y procesa los nuevos o los que quedaron a medias.
 * Solo considera comentarios de los últimos 7 días (límite de Meta para private replies):
 * así un post antiguo no responde a comentarios viejos, pero sí a los nuevos.
 */
export async function pollMedia(mediaId: string, deps: Deps, source = "poll", now = new Date()) {
  const comments = flatten(await deps.ig.mediaComments(mediaId)).filter(
    (c) => !c.timestamp || now.getTime() - new Date(c.timestamp).getTime() < SEVEN_DAYS_MS,
  );
  const known = await deps.store.knownComments(mediaId);
  const counts: Partial<Record<Outcome, number>> = {};
  for (const c of comments) {
    const k = known.get(c.id);
    if (k && (!k.matched || (k.dm_sent && k.replied) || k.attempts > MAX_ATTEMPTS)) continue;
    const outcome = await processComment(
      { id: c.id, text: c.text ?? "", mediaId, fromId: c.from?.id, username: c.from?.username ?? c.username, createdAt: c.timestamp },
      source,
      deps,
    );
    counts[outcome] = (counts[outcome] ?? 0) + 1;
  }
  return { mediaId, comments: comments.length, ...counts };
}

/** Completa media_id de las reglas que solo tienen el link del post. */
export async function resolveRuleLinks(deps: Deps, igUserId: string, keywords: Keyword[]) {
  for (const k of keywords) {
    if (!k.post_url || k.media_id) continue;
    if ((k as Keyword & { resolve_error?: string | null }).resolve_error?.includes(k.post_url)) continue; // ya falló con este link
    const sc = shortcodeFromUrl(k.post_url);
    if (!sc) {
      await deps.store.updateKeyword(k.id, { resolve_error: `Link no válido: ${k.post_url}` });
      continue;
    }
    const id = await deps.ig.findMediaByShortcode(igUserId, sc);
    if (id) {
      k.media_id = id;
      await deps.store.updateKeyword(k.id, { media_id: id, resolve_error: null });
    } else {
      await deps.store.updateKeyword(k.id, { resolve_error: `No encontré ese post en tu cuenta: ${k.post_url}` });
    }
  }
}

/**
 * Revisa los posts que tienen reglas activas (y, si existe alguna regla global, también tus últimos
 * POLL_MEDIA_LIMIT posts). Para no gastar llamadas, solo relee un post si cambió su número de
 * comentarios, si tiene envíos pendientes o si pasaron 15 minutos.
 */
export async function pollRecent(deps: Deps, now = new Date()) {
  const { ig_user_id } = await deps.store.getState();
  if (!ig_user_id) throw new Error("Falta ig_user_id en app_state");

  const keywords = await deps.store.activeKeywords();
  await resolveRuleLinks(deps, ig_user_id, keywords);

  const media: MediaSummary[] = [];
  const listed = new Set<string>();
  if (keywords.some(isGlobal)) {
    for (const m of await deps.ig.recentMedia(ig_user_id, Number(process.env.POLL_MEDIA_LIMIT ?? 50))) {
      media.push(m);
      listed.add(m.id);
    }
  }
  for (const k of keywords) {
    if (k.media_id && !listed.has(k.media_id)) {
      listed.add(k.media_id);
      media.push(await deps.ig.mediaInfo(k.media_id));
    }
  }

  const [states, pending] = await Promise.all([deps.store.mediaStates(), deps.store.pendingMediaIds(MAX_ATTEMPTS)]);
  const results = [];
  for (const m of media) {
    const st = states.get(m.id);
    const changed = m.comments_count === undefined || !st || st.comments_count !== m.comments_count;
    const stale = !st || now.getTime() - new Date(st.scanned_at).getTime() > FULL_RESCAN_MS;
    if (!changed && !stale && !pending.has(m.id)) continue;
    results.push(await pollMedia(m.id, deps, "poll", now));
    await deps.store.saveMediaState(m.id, m.comments_count ?? null);
  }
  return { media: media.length, scanned: results.length, results };
}
