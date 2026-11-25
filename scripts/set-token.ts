// Guarda el token de larga duración en Supabase.
// Uso: IG_ACCESS_TOKEN=... npx tsx --env-file=.env scripts/set-token.ts
import { createIgApi } from "../lib/instagram.js";
import { supabaseStore } from "../lib/store.js";

const token = process.env.IG_ACCESS_TOKEN;
if (!token) throw new Error("Falta IG_ACCESS_TOKEN");
const me = await createIgApi(() => token).me();
await supabaseStore().updateState({
  ig_user_id: me.user_id,
  ig_username: me.username,
  access_token: token,
  // El token generado en el dashboard dura 60 días. El cron lo renueva antes.
  token_expires_at: new Date(Date.now() + 60 * 86400 * 1000).toISOString(),
  token_refreshed_at: new Date().toISOString(),
});
console.log(`Token guardado para @${me.username} (${me.user_id}).`);
