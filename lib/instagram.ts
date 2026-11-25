/**
 * Host de la Graph API.
 * - "Unified login" (apps nuevas, token de usuario del sistema que no caduca): graph.facebook.com  ← por defecto
 * - "Instagram Login" (apps antiguas, token de 60 días): graph.instagram.com
 */
export function graphHost(): string {
  return `https://${process.env.GRAPH_HOST ?? "graph.facebook.com"}`;
}
export const isInstagramLogin = () => graphHost().includes("graph.instagram.com");

export class GraphError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: number,
    public subcode?: number,
    public transient = false,
  ) {
    super(message);
  }
}

export interface IgComment {
  id: string;
  text: string;
  timestamp?: string;
  username?: string;
  from?: { id: string; username?: string };
  replies?: { data: IgComment[] };
}

export interface MediaSummary {
  id: string;
  timestamp: string;
  comments_count?: number;
}

export interface IgApi {
  sendPrivateReply(igUserId: string, commentId: string, text: string): Promise<{ message_id: string }>;
  replyToComment(commentId: string, text: string): Promise<{ id: string }>;
  recentMedia(igUserId: string, limit?: number): Promise<MediaSummary[]>;
  mediaComments(mediaId: string, maxPages?: number): Promise<IgComment[]>;
  mediaInfo(mediaId: string): Promise<MediaSummary>;
  /** URL temporal de la miniatura del post (las de Instagram caducan: pedirla cada vez). */
  thumbnail(mediaId: string): Promise<string | null>;
  /** Busca entre tus posts el que tenga ese shortcode (del link). */
  findMediaByShortcode(igUserId: string, shortcode: string, maxPages?: number): Promise<string | null>;
  /** Datos de la cuenta. Con Instagram Login usa /me; con Unified login, /{IG_USER_ID}. */
  account(igUserId?: string): Promise<{ id: string; username: string }>;
  refreshToken(): Promise<{ access_token: string; expires_in: number }>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Errores de Meta que vale la pena reintentar: rate limit / temporales.
const TRANSIENT_CODES = new Set([1, 2, 4, 17, 32, 341, 613]);

export function createIgApi(
  getToken: () => string,
  opts: { version?: string; host?: string; fetchImpl?: typeof fetch; retries?: number; baseDelayMs?: number } = {},
): IgApi {
  const HOST = opts.host ?? graphHost();
  const version = opts.version ?? process.env.GRAPH_API_VERSION ?? "v25.0";
  const f = opts.fetchImpl ?? fetch;
  const retries = opts.retries ?? 3;
  const baseDelay = opts.baseDelayMs ?? 500;

  async function call<T>(method: "GET" | "POST", path: string, body?: unknown, versioned = true): Promise<T> {
    const url = `${HOST}${versioned ? `/${version}` : ""}${path}`;
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await sleep(baseDelay * 3 ** (attempt - 1));
      try {
        const res = await f(url, {
          method,
          headers: {
            Authorization: `Bearer ${getToken()}`,
            ...(body ? { "Content-Type": "application/json" } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
        });
        const json: any = await res.json().catch(() => ({}));
        if (res.ok && !json.error) return json as T;
        const e = json.error ?? {};
        const transient = res.status >= 500 || res.status === 429 || e.is_transient === true || TRANSIENT_CODES.has(e.code);
        lastErr = new GraphError(
          `${e.message ?? `HTTP ${res.status}`}${e.code ? ` (code ${e.code}${e.error_subcode ? `/${e.error_subcode}` : ""})` : ""}`,
          res.status,
          e.code,
          e.error_subcode,
          transient,
        );
        if (!transient) throw lastErr;
      } catch (err) {
        if (err instanceof GraphError && !err.transient) throw err;
        lastErr = err; // error de red o transitorio: reintentar
      }
    }
    throw lastErr;
  }

  return {
    sendPrivateReply: (igUserId, commentId, text) =>
      call("POST", `/${igUserId}/messages`, { recipient: { comment_id: commentId }, message: { text } }),
    replyToComment: (commentId, text) => call("POST", `/${commentId}/replies`, { message: text }),
    async recentMedia(igUserId, limit = 50) {
      const r = await call<{ data: MediaSummary[] }>("GET", `/${igUserId}/media?fields=id,timestamp,comments_count&limit=${limit}`);
      return r.data;
    },
    async mediaComments(mediaId, maxPages = 40) {
      const fields = "id,text,timestamp,username,from,replies{id,text,timestamp,username,from}";
      const out: IgComment[] = [];
      let path: string | null = `/${mediaId}/comments?fields=${encodeURIComponent(fields)}&limit=50`;
      for (let i = 0; path && i < maxPages; i++) {
        const r: { data: IgComment[]; paging?: { next?: string } } = await call("GET", path);
        out.push(...r.data);
        path = r.paging?.next ? r.paging.next.replace(/^https:\/\/graph\.(instagram|facebook)\.com\/v[\d.]+/, "") : null;
      }
      return out;
    },
    mediaInfo: (mediaId) => call("GET", `/${mediaId}?fields=id,timestamp,comments_count`),
    async thumbnail(mediaId) {
      const r = await call<{ media_type?: string; media_url?: string; thumbnail_url?: string }>(
        "GET",
        `/${mediaId}?fields=media_type,media_url,thumbnail_url`,
      );
      return r.thumbnail_url ?? (r.media_type === "VIDEO" ? null : r.media_url) ?? null;
    },
    async findMediaByShortcode(igUserId, shortcode, maxPages = 20) {
      let path: string | null = `/${igUserId}/media?fields=id,shortcode,permalink&limit=100`;
      for (let i = 0; path && i < maxPages; i++) {
        const r: { data: { id: string; shortcode?: string; permalink?: string }[]; paging?: { next?: string } } = await call("GET", path);
        const hit = r.data.find((m) => m.shortcode === shortcode || m.permalink?.includes(`/${shortcode}/`));
        if (hit) return hit.id;
        path = r.paging?.next ? r.paging.next.replace(/^https:\/\/graph\.(instagram|facebook)\.com\/v[\d.]+/, "") : null;
      }
      return null;
    },
    async account(igUserId) {
      if (HOST.includes("graph.instagram.com")) {
        const r = await call<{ user_id: string; username: string }>("GET", `/me?fields=user_id,username`);
        return { id: r.user_id, username: r.username };
      }
      if (!igUserId) throw new Error("Falta IG_USER_ID");
      return call("GET", `/${igUserId}?fields=id,username`);
    },
    refreshToken: () =>
      call(
        "GET",
        `/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(getToken())}`,
        undefined,
        false,
      ),
  };
}
