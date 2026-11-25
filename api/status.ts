import { isLoggedIn, unauthorized } from "../lib/auth.js";
import { supabaseStore } from "../lib/store.js";

// Estado y registro para el panel. /api/status?format=csv descarga el registro (prueba para marcas).
export async function GET(req: Request) {
  if (!isLoggedIn(req)) return unauthorized();
  const store = supabaseStore();
  const [s, events] = await Promise.all([store.getState(), store.recentEvents(500)]);
  const matched = events.filter((e) => e.matched);

  if (new URL(req.url).searchParams.get("format") === "csv") {
    const cols = ["created_at", "comment_id", "media_id", "keyword_id", "username", "text", "dm_sent", "dm_sent_at", "dm_undeliverable", "replied", "replied_at", "error"] as const;
    const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [cols.join(","), ...matched.map((e) => cols.map((c) => cell((e as any)[c])).join(","))].join("\n");
    return new Response("﻿" + csv, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=envios.csv" },
    });
  }

  const daysLeft = s.token_expires_at ? Math.floor((new Date(s.token_expires_at).getTime() - Date.now()) / 86400000) : null;
  return Response.json({
    account: s.ig_username,
    token: { daysLeft, error: s.last_refresh_error, checkedAt: s.token_refreshed_at },
    poll: { at: s.last_poll_at, error: s.last_poll_error },
    totals: {
      matched: matched.length,
      dm: matched.filter((e) => e.dm_sent).length,
      fallback: matched.filter((e) => !e.dm_sent && e.dm_undeliverable).length,
      withError: matched.filter((e) => e.error).length,
    },
    events: matched.slice(0, 100).map((e) => ({
      created_at: e.created_at,
      username: e.username,
      text: e.text,
      keyword_id: e.keyword_id,
      dm_sent: e.dm_sent,
      dm_undeliverable: e.dm_undeliverable,
      replied: e.replied,
      error: e.error,
    })),
  });
}
