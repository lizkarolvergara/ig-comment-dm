export interface Keyword {
  id: number;
  keyword: string;
  dm_message: string;
  public_reply: string;
  media_id: string | null;
  active: boolean;
}

/** Minúsculas y sin tildes: "Lúpa" -> "lupa". */
export function normalize(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** ¿El texto contiene la palabra clave como palabra completa? ("quiero LUPA!!" sí, "lupanar" no) */
export function containsKeyword(text: string, keyword: string): boolean {
  const kw = normalize(keyword).trim();
  if (!kw) return false;
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegex(kw)}($|[^\\p{L}\\p{N}])`, "u");
  return re.test(normalize(text));
}

/** Elige la palabra clave activa que aplica: primero las del post, luego las globales. */
export function pickKeyword(text: string, mediaId: string | null, keywords: Keyword[]): Keyword | null {
  const active = keywords.filter((k) => k.active);
  const specific = active.filter((k) => k.media_id && k.media_id === mediaId);
  const global = active.filter((k) => !k.media_id);
  return [...specific, ...global].find((k) => containsKeyword(text, k.keyword)) ?? null;
}

/** "¡Te lo envié! 📩 | ¡Revisa tu DM! ✨" -> una al azar. Variar evita que Instagram lo marque como spam. */
export function pickVariant(template: string, rand: () => number = Math.random): string {
  const options = template.split("|").map((s) => s.trim()).filter(Boolean);
  return options[Math.floor(rand() * options.length)] ?? template.trim();
}
