// Reprocesa los comentarios de un post (nuevos o fallidos). Respeta la idempotencia: no envía dos veces.
// Uso: npx tsx --env-file=.env scripts/reprocess.ts <MEDIA_ID>   (sin MEDIA_ID: posts de los últimos 7 días)
import { loadDeps } from "../lib/context.js";
import { pollMedia, pollRecent } from "../lib/poll.js";

const mediaId = process.argv[2];
const deps = await loadDeps();
console.log(JSON.stringify(mediaId ? await pollMedia(mediaId, deps, "manual") : await pollRecent(deps), null, 2));
