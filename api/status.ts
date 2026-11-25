import { supabaseStore } from "../lib/store.js";

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
const TZ = process.env.DISPLAY_TZ ?? "UTC";
const yes = (b: boolean) => (b ? "✅" : "—");

// Página de estado: /api/status?token=STATUS_TOKEN  (añade &format=json o &format=csv para exportar)
export async function GET(req: Request) {
  const url = new URL(req.url);
  if (!process.env.STATUS_TOKEN || url.searchParams.get("token") !== process.env.STATUS_TOKEN) {
    return new Response("Unauthorized", { status: 401 });
  }
  const store = supabaseStore();
  const [s, events] = await Promise.all([store.getState(), store.recentEvents(500)]);
  const matched = events.filter((e) => e.matched);
  const daysLeft = s.token_expires_at
    ? Math.floor((new Date(s.token_expires_at).getTime() - Date.now()) / 86400000)
    : null;

  const format = url.searchParams.get("format");
  if (format === "json") return Response.json({ daysLeft, state: { ...s, access_token: undefined }, events: matched });
  if (format === "csv") {
    const cols = ["created_at", "comment_id", "media_id", "username", "text", "dm_sent", "dm_sent_at", "replied", "replied_at", "error"] as const;
    const csv = [cols.join(","), ...matched.map((e) => cols.map((c) => `"${String((e as any)[c] ?? "").replace(/"/g, '""')}"`).join(","))].join("\n");
    return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=envios.csv" } });
  }

  const ok = matched.filter((e) => e.dm_sent && e.replied).length;
  const failed = matched.filter((e) => e.error);
  const rows = matched
    .slice(0, 100)
    .map(
      (e) =>
        `<tr><td>${esc(new Date(e.created_at!).toLocaleString("es", { timeZone: TZ }))}</td><td>@${esc(e.username)}</td><td>${esc(e.text)}</td><td>${yes(e.dm_sent)}</td><td>${yes(e.replied)}</td><td class="err">${esc(e.error)}</td></tr>`,
    )
    .join("");

  const html = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Estado del bot</title>
<style>body{font:14px system-ui;margin:16px;max-width:1000px}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:6px;text-align:left;vertical-align:top}.err{color:#b00}.card{display:inline-block;padding:8px 12px;margin:0 8px 8px 0;border:1px solid #ddd;border-radius:8px}</style>
<h1>Bot @${esc(s.ig_username)}</h1>
<div class="card">Token: <b>${daysLeft === null ? "no caduca" : `${daysLeft} días`}</b> ${s.last_refresh_error ? `<span class="err">(${esc(s.last_refresh_error)})</span>` : ""}</div>
<div class="card">Último chequeo: ${esc(s.last_poll_at ? new Date(s.last_poll_at).toLocaleString("es", { timeZone: TZ }) : "nunca")} ${s.last_poll_error ? `<span class="err">${esc(s.last_poll_error)}</span>` : "✅"}</div>
<div class="card">Coincidencias: <b>${matched.length}</b> · completas: <b>${ok}</b> · con error: <b>${failed.length}</b></div>
<p><a href="?token=${esc(url.searchParams.get("token"))}&format=csv">Descargar registro (CSV)</a></p>
<table><tr><th>Fecha</th><th>Usuario</th><th>Comentario</th><th>DM</th><th>Pública</th><th>Error</th></tr>${rows}</table></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
