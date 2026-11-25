import { isAuthorized } from "../lib/context.js";
import { refreshIfNeeded } from "../lib/refresh.js";
import { supabaseStore } from "../lib/store.js";

// Cron diario de Vercel (ver vercel.json).
export async function GET(req: Request) {
  if (!isAuthorized(req)) return new Response("Unauthorized", { status: 401 });
  return Response.json(await refreshIfNeeded(supabaseStore()));
}
