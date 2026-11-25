import type { IgComment } from "./instagram.js";
import { MAX_ATTEMPTS, processComment, type Deps, type Outcome } from "./process.js";

const SEVEN_DAYS_MS = 7 * 24 * 3600 * 1000;

function flatten(comments: IgComment[]): IgComment[] {
  return comments.flatMap((c) => [c, ...(c.replies?.data ?? [])]);
}

/** Revisa los comentarios de un post y procesa los nuevos o los que quedaron a medias. */
export async function pollMedia(mediaId: string, deps: Deps, source = "poll") {
  const comments = flatten(await deps.ig.mediaComments(mediaId));
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

/** Revisa los posts de los últimos 7 días (el límite de Meta para private replies). */
export async function pollRecent(deps: Deps, now = new Date()) {
  const { ig_user_id } = await deps.store.getState();
  if (!ig_user_id) throw new Error("Falta ig_user_id en app_state");
  const media = (await deps.ig.recentMedia(ig_user_id, 25)).filter(
    (m) => now.getTime() - new Date(m.timestamp).getTime() < SEVEN_DAYS_MS + 24 * 3600 * 1000,
  );
  const results = [];
  for (const m of media) results.push(await pollMedia(m.id, deps));
  return results;
}
