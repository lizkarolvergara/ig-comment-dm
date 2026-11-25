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
  allKeywords(): Promise<Keyword[]>;
  createKeyword(row: Partial<Keyword>): Promise<Keyword>;
  /** Borra una regla. Falla si ya tiene envíos registrados (para no perder la prueba). */
  deleteKeyword(id: number): Promise<void>;
  /** Conteo de envíos por regla: { keyword_id: { dm, fallback, pending } } */
  ruleStats(): Promise<Record<number, { dm: number; fallback: number; pending: number }>>;
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
  /** Coincidencias sin completar (sin respuesta pública o sin DM) desde una fecha, para el monitoreo. */
  unresolvedEvents(sinceIso: string): Promise<EventRow[]>;
  /** Vuelve a poner el evento en cola: el lector lo reintenta en el próximo minuto. */
  resetEvent(commentId: string): Promise<boolean>;
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
    async allKeywords() {
      return check(await db.from("keywords").select("*").order("created_at", { ascending: false })) as Keyword[];
    },
    async createKeyword(row) {
      return check(await db.from("keywords").insert(row).select("*").single()) as Keyword;
    },
    async deleteKeyword(id) {
      const r = await db.from("keywords").delete().eq("id", id);
      if (r.error?.code === "23503") throw new Error("Esta regla ya tiene envíos registrados: desactívala en vez de borrarla.");
      check(r);
    },
    async ruleStats() {
      const data = check(
        await db.from("events").select("keyword_id,dm_sent,dm_undeliverable,replied").eq("matched", true),
      ) as { keyword_id: number; dm_sent: boolean; dm_undeliverable: boolean; replied: boolean }[];
      const out: Record<number, { dm: number; fallback: number; pending: number }> = {};
      for (const e of data) {
        const s = (out[e.keyword_id] ??= { dm: 0, fallback: 0, pending: 0 });
        if (e.dm_sent) s.dm++;
        else if (e.dm_undeliverable) s.fallback++;
        if (!e.replied) s.pending++;
      }
      return out;
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
    async unresolvedEvents(sinceIso) {
      return check(
        await db
          .from("events")
          .select("*")
          .eq("matched", true)
          .or("replied.eq.false,dm_sent.eq.false")
          .gte("created_at", sinceIso)
          .order("created_at", { ascending: false })
          .limit(300),
      ) as EventRow[];
    },
    async resetEvent(commentId) {
      const data = check(
        await db
          .from("events")
          .update({ attempts: 0, error: null, locked_until: null, dm_undeliverable: false, updated_at: new Date().toISOString() })
          .eq("comment_id", commentId)
          .eq("matched", true)
          .eq("replied", false)
          .select("comment_id"),
      ) as unknown[];
      return data.length > 0;
    },
    async recentEvents(limit) {
      return check(await db.from("events").select("*").order("created_at", { ascending: false }).limit(limit)) as EventRow[];
    },
  };
}
