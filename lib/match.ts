export interface Keyword {
  id: number;
  keyword: string;
  dm_message: string;
  public_reply: string;
  media_id: string | null;
  post_url?: string | null;
  /** Respuesta pública si no se pudo entregar el DM. Vacía = texto por defecto. */
  fallback_reply?: string | null;
  active: boolean;
}

/** Una regla es global solo si no tiene ni post_url ni media_id. */
export const isGlobal = (k: Keyword) => !k.media_id && !k.post_url;

/** Extrae el shortcode de un link de Instagram: instagram.com/p/ABC123/ -> "ABC123". */
export function shortcodeFromUrl(url: string): string | null {
  const m = url.match(/instagram\.com\/(?:[^/]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
  return m?.[1] ?? null;
}

/** Minúsculas y sin tildes: "Lúpa" -> "lupa". */
export function normalize(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * ¿El texto contiene la palabra clave como palabra completa? ("quiero LUPA!!" sí, "lupanar" no)
 * La palabra puede traer variantes separadas por comas para cubrir errores: "LUPA, LUPPA, LOPA".
 * También acepta frases: "quiero info".
 */
export function containsKeyword(text: string, keyword: string): boolean {
  const t = normalize(text);
  return keyword
    .split(",")
    .map((k) => normalize(k).trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .some((kw) => {
      const pattern = kw.split(" ").map(escapeRegex).join("\\s+");
      return new RegExp(`(^|[^\\p{L}\\p{N}])${pattern}($|[^\\p{L}\\p{N}])`, "u").test(t);
    });
}

/** Elige la palabra clave activa que aplica: primero las del post, luego las globales. */
export function pickKeyword(text: string, mediaId: string | null, keywords: Keyword[]): Keyword | null {
  const active = keywords.filter((k) => k.active);
  const specific = active.filter((k) => k.media_id && k.media_id === mediaId);
  const global = active.filter(isGlobal);
  return [...specific, ...global].find((k) => containsKeyword(text, k.keyword)) ?? null;
}

/** "¡Te lo envié! 📩 | ¡Revisa tu DM! ✨" -> una al azar. Variar evita que Instagram lo marque como spam. */
export function pickVariant(template: string, rand: () => number = Math.random): string {
  const options = template.split("|").map((s) => s.trim()).filter(Boolean);
  return options[Math.floor(rand() * options.length)] ?? template.trim();
}

/** Reemplaza {usuario} (o {user}) por @usuario. Si no se conoce el usuario, lo quita sin dejar espacios dobles. */
export function fillTemplate(text: string, username?: string | null): string {
  const tag = username ? `@${username.replace(/^@/, "")}` : "";
  return text
    .replace(/\{\s*(usuario|user)\s*\}/gi, tag)
    .replace(/[ \t]{2,}/g, " ")
    .replace(/^[ \t]+|[ \t]+$/gm, "")
    .replace(/[ \t]+([,.!?])/g, "$1");
}
