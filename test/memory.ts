import type { IgApi, IgComment } from "../lib/instagram.js";
import type { Keyword } from "../lib/match.js";
import type { AppState, EventRow, Store } from "../lib/store.js";

export function memoryStore(keywords: Keyword[], state: Partial<AppState> = {}) {
  const mediaState = new Map<string, { comments_count: number | null; scanned_at: string }>();
  const events = new Map<string, EventRow & { locked_until?: string | null }>();
  let st: AppState = {
    ig_user_id: "ME",
    ig_username: "hueleanaranjas",
    access_token: "tok",
    token_expires_at: null,
    token_refreshed_at: null,
    last_poll_at: null,
    last_poll_error: null,
    last_refresh_error: null,
    ...state,
  };
  const store: Store = {
    getState: async () => ({ ...st }),
    updateState: async (p) => void (st = { ...st, ...p }),
    activeKeywords: async () => keywords.filter((k) => k.active),
    insertEvent: async (row) => {
      if (events.has(row.comment_id)) return false;
      events.set(row.comment_id, { ...row, dm_sent: false, replied: false, attempts: 0, error: null });
      return true;
    },
    claim: async (id) => {
      const e = events.get(id);
      if (!e || !e.matched || (e.dm_sent && e.replied)) return null;
      if (e.locked_until && new Date(e.locked_until) > new Date()) return null;
      e.locked_until = new Date(Date.now() + 60000).toISOString();
      e.attempts++;
      return { ...e };
    },
    updateEvent: async (id, p) => void Object.assign(events.get(id)!, p),
    knownComments: async (mediaId) =>
      new Map([...events.values()].filter((e) => e.media_id === mediaId).map((e) => [e.comment_id, e])),
    recentEvents: async () => [...events.values()],
    mediaStates: async () => new Map(mediaState),
    saveMediaState: async (id, n) => void mediaState.set(id, { comments_count: n, scanned_at: new Date().toISOString() }),
    pendingMediaIds: async () =>
      new Set([...events.values()].filter((e) => e.matched && (!e.dm_sent || !e.replied)).map((e) => e.media_id!)),
  };
  return { store, events, mediaState, state: () => st };
}

export function fakeIg(opts: { failDm?: number; failReply?: number; comments?: Record<string, IgComment[]>; media?: { id: string; timestamp: string; comments_count?: number }[] } = {}) {
  const calls = { dm: [] as string[], reply: [] as { id: string; text: string }[], scanned: [] as string[] };
  let failDm = opts.failDm ?? 0;
  let failReply = opts.failReply ?? 0;
  const ig: IgApi = {
    sendPrivateReply: async (_u, id) => {
      if (failDm-- > 0) throw new Error("boom dm");
      calls.dm.push(id);
      return { message_id: `m_${id}` };
    },
    replyToComment: async (id, text) => {
      if (failReply-- > 0) throw new Error("boom reply");
      calls.reply.push({ id, text });
      return { id: `r_${id}` };
    },
    recentMedia: async () => opts.media ?? [],
    mediaComments: async (m) => {
      calls.scanned.push(m);
      return opts.comments?.[m] ?? [];
    },
    account: async () => ({ id: "ME", username: "hueleanaranjas" }),
    refreshToken: async () => ({ access_token: "new", expires_in: 5184000 }),
  };
  return { ig, calls };
}

export const LUPA: Keyword = {
  id: 1,
  keyword: "LUPA",
  dm_message: "¡Hola! Aquí tienes: https://lupa.art/explore",
  public_reply: "¡Te lo envié por DM! 📩",
  media_id: null,
  active: true,
};
