import type { Keyword } from "./match.js";
import { shortcodeFromUrl } from "./match.js";

export interface RuleInput {
  post_url?: string;
  keyword?: string;
  dm_message?: string;
  public_reply?: string;
  fallback_reply?: string | null;
  active?: boolean;
}

const clean = (s: unknown) => (typeof s === "string" ? s.trim() : "");

/** Valida y normaliza lo que llega del formulario. Devuelve errores legibles. */
export function validateRule(input: RuleInput, partial = false): { value: Partial<Keyword> & { fallback_reply?: string | null }; errors: string[] } {
  const errors: string[] = [];
  const v: Partial<Keyword> & { fallback_reply?: string | null } = {};
  const has = (k: keyof RuleInput) => !partial || k in input;

  if (has("post_url")) {
    const url = clean(input.post_url);
    if (!shortcodeFromUrl(url)) errors.push("El link del post no es válido (debe ser instagram.com/p/… o /reel/…).");
    else v.post_url = url;
  }
  if (has("keyword")) {
    const kw = clean(input.keyword);
    if (!kw.split(",").some((k) => k.trim())) errors.push("Falta la palabra clave.");
    else v.keyword = kw;
  }
  if (has("dm_message")) {
    const dm = clean(input.dm_message);
    if (!dm) errors.push("Falta el mensaje del DM.");
    else if (dm.length > 1000) errors.push("El DM no puede pasar de 1000 caracteres.");
    else v.dm_message = dm;
  }
  if (has("public_reply")) {
    const pr = clean(input.public_reply);
    if (!pr.split("|").some((t) => t.trim())) errors.push("Falta la respuesta pública.");
    else v.public_reply = pr;
  }
  if ("fallback_reply" in input) v.fallback_reply = clean(input.fallback_reply) || null;
  if ("active" in input) v.active = !!input.active;
  return { value: v, errors };
}
