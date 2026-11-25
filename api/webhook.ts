import { waitUntil } from "@vercel/functions";
import { alert } from "../lib/alert.js";
import { loadDeps } from "../lib/context.js";
import { processComment } from "../lib/process.js";
import { verifySignature } from "../lib/signature.js";
import { parseCommentsPayload } from "../lib/webhook.js";

// Verificación inicial de Meta: devuelve hub.challenge si el verify token coincide.
export function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  if (p.get("hub.mode") === "subscribe" && p.get("hub.verify_token") === process.env.IG_VERIFY_TOKEN) {
    return new Response(p.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"), process.env.META_APP_SECRET ?? process.env.IG_APP_SECRET ?? "")) {
    return new Response("Invalid signature", { status: 401 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  const comments = parseCommentsPayload(payload);

  // Responder 200 ya y procesar después. Si algo se corta, el lector (poll) lo recupera.
  waitUntil(
    (async () => {
      try {
        const deps = await loadDeps();
        for (const c of comments) await processComment(c, "webhook", deps);
      } catch (e) {
        await alert(`Error procesando webhook: ${(e as Error).message}`);
      }
    })(),
  );
  return new Response("EVENT_RECEIVED", { status: 200 });
}
