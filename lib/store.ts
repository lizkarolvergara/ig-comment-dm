import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Keyword } from "./match.js";

export interface EventRow {
  comment_id: string;
  media_id: string | null;
  ig_user_id: string | null;
  username: string | null;
  text: string | null;
  comment_created_at: string | null;
  source: string;
  matched: boolean;
  keyword_id: number | null;
  dm_sent: boolean;
  dm_undeliverable?: boolean;
  dm_sent_at?: string | null;
  dm_message_id?: string | null;
  replied: boolean;
  replied_at?: string | null;
  reply_id?: string | null;
  attempts: number;
  error: string | null;
  created_at?: string;
}

export interface AppState {
  ig_user_id: string | null;
  ig_username: string | null;
  access_token: string | null;
  token_expires_at: string | null;
  token_refreshed_at: string | null;
  last_poll_at: string | null;
  last_poll_error: string | null;
  last_refresh_error: string | null;
}

export interface Store {
  getState(): Promise<AppState>;
  updateState(patch: Partial<AppState>): Promise<void>;
  activeKeywords(): Promise<Keyword[]>;
  updateKeyword(id: number, patch: Partial<Keyword> & { resolve_error?: string | null }): Promise<void>;
  /** Inserta si no existe. Devuelve true si era nuevo. */
  insertEvent(row: Omit<EventRow, "dm_sent" | "dm_undeliverable" | "replied" | "attempts" | "error">): Promise<boolean>;
  /** Reserva el evento (lock ~60s). null si ya está completo o lo tiene otro proceso. */
  claim(commentId: string): Promise<EventRow | null>;
  updateEvent(commentId: string, patch: Partial<EventRow> & { locked_until?: string | null }): Promise<void>;
  knownComments(mediaId: string): Promise<Map<string, Pick<EventRow, "matched" | "dm_sent" | "dm_undeliverable" | "replied" | "attempts">>>;
  recentEvents(limit: number): Promise<EventRow[]>;
  mediaStates(): Promise<Map<string, { comments_count: number | null; scanned_at: string }>>;
  saveMediaState(mediaId: string, commentsCount: number | null): Promise<void>;
  /** Posts con comentarios que coincidieron pero quedaron a medias (para reintentar). */
  pendingMediaIds(maxAttempts: number): Promise<Set<string>>;
}

export function supabaseStore(client?: SupabaseClient): Store {
  const db =
    client ??
    createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
  const check = <T>(r: { data: T; error: any }): T => {
    if (r.error) throw new Error(`Supabase: ${r.error.message}`);
    return r.data;
  };
  return {
    async getState() {
      return check(await db.from("app_state").select("*").eq("id", 1).single()) as AppState;
    },
    async updateState(patch) {
      check(await db.from("app_state").update(patch).eq("id", 1));
    },
    async activeKeywords() {
      return check(await db.from("keywords").select("*").eq("active", true)) as Keyword[];
    },
    async updateKeyword(id, patch) {
      check(await db.from("keywords").update(patch).eq("id", id));
    },
    async insertEvent(row) {
      const data = check(
        await db.from("events").upsert(row, { onConflict: "comment_id", ignoreDuplicates: true }).select("comment_id"),
      ) as unknown[];
      return data.length > 0;
    },
    async claim(commentId) {
      const data = check(await db.rpc("claim_event", { p_comment_id: commentId, p_seconds: 60 })) as EventRow[];
      return data[0] ?? null;
    },
    async updateEvent(commentId, patch) {
      check(await db.from("events").update({ ...patch, updated_at: new Date().toISOString() }).eq("comment_id", commentId));
    },
    async knownComments(mediaId) {
      const data = check(
        await db.from("events").select("comment_id,matched,dm_sent,dm_undeliverable,replied,attempts").eq("media_id", mediaId),
      ) as (EventRow & { comment_id: string })[];
      return new Map(data.map((r) => [r.comment_id, r]));
    },
    async mediaStates() {
      const data = check(await db.from("media_state").select("*")) as { media_id: string; comments_count: number | null; scanned_at: string }[];
      return new Map(data.map((r) => [r.media_id, r]));
    },
    async saveMediaState(mediaId, commentsCount) {
      check(
        await db
          .from("media_state")
          .upsert({ media_id: mediaId, comments_count: commentsCount, scanned_at: new Date().toISOString() }),
      );
    },
    async pendingMediaIds(maxAttempts) {
      const data = check(
        await db
          .from("events")
          .select("media_id,error")
          .eq("matched", true)
          .eq("replied", false)
          .lte("attempts", maxAttempts),
      ) as { media_id: string | null; error: string | null }[];
      // Los que vencieron la ventana de 7 días ya no se pueden completar.
      return new Set(data.filter((r) => r.media_id && !r.error?.includes("7 días")).map((r) => r.media_id!));
    },
    async recentEvents(limit) {
      return check(await db.from("events").select("*").order("created_at", { ascending: false }).limit(limit)) as EventRow[];
    },
  };
}
