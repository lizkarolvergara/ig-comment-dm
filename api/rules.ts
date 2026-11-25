import { isLoggedIn, unauthorized } from "../lib/auth.js";
import { loadDeps } from "../lib/context.js";
import { shortcodeFromUrl } from "../lib/match.js";
import { validateRule, type RuleInput } from "../lib/rules.js";
import { supabaseStore, type Store } from "../lib/store.js";

const bad = (error: string, status = 400) => Response.json({ error }, { status });

/** Busca el post del link entre tus posts y devuelve su media_id. */
async function resolve(store: Store, postUrl: string): Promise<string> {
  const deps = await loadDeps(store);
  const { ig_user_id } = await store.getState();
  const id = await deps.ig.findMediaByShortcode(ig_user_id!, shortcodeFromUrl(postUrl)!);
  if (!id) throw new Error("No encontré ese post entre tus publicaciones. ¿Es de @" + ((await store.getState()).ig_username ?? "tu cuenta") + "?");
  return id;
}

const idFrom = (req: Request) => Number(new URL(req.url).searchParams.get("id"));

export async function GET(req: Request) {
  if (!isLoggedIn(req)) return unauthorized();
  const store = supabaseStore();
  const [rules, stats] = await Promise.all([store.allKeywords(), store.ruleStats()]);
  return Response.json({ rules: rules.map((r) => ({ ...r, stats: stats[r.id] ?? { dm: 0, fallback: 0, pending: 0 } })) });
}

export async function POST(req: Request) {
  if (!isLoggedIn(req)) return unauthorized();
  const { value, errors } = validateRule((await req.json().catch(() => ({}))) as RuleInput);
  if (errors.length) return bad(errors.join(" "));
  const store = supabaseStore();
  try {
    const media_id = await resolve(store, value.post_url!);
    const rule = await store.createKeyword({ ...value, media_id, active: value.active ?? true, resolve_error: null } as any);
    return Response.json({ rule }, { status: 201 });
  } catch (e) {
    return bad((e as Error).message);
  }
}

export async function PATCH(req: Request) {
  if (!isLoggedIn(req)) return unauthorized();
  const id = idFrom(req);
  if (!id) return bad("Falta id");
  const { value, errors } = validateRule((await req.json().catch(() => ({}))) as RuleInput, true);
  if (errors.length) return bad(errors.join(" "));
  const store = supabaseStore();
  try {
    const current = (await store.allKeywords()).find((k) => k.id === id);
    if (!current) return bad("No existe esa regla", 404);
    const patch: any = { ...value };
    if (value.post_url && value.post_url !== current.post_url) {
      patch.media_id = await resolve(store, value.post_url);
      patch.resolve_error = null;
    }
    await store.updateKeyword(id, patch);
    return Response.json({ ok: true });
  } catch (e) {
    return bad((e as Error).message);
  }
}

export async function DELETE(req: Request) {
  if (!isLoggedIn(req)) return unauthorized();
  const id = idFrom(req);
  if (!id) return bad("Falta id");
  try {
    await supabaseStore().deleteKeyword(id);
    return Response.json({ ok: true });
  } catch (e) {
    return bad((e as Error).message, 409);
  }
}
