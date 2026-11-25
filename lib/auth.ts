import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE = "session";
const MAX_AGE_S = 30 * 24 * 3600;

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("Falta SESSION_SECRET (mínimo 32 caracteres)");
  return s;
}

const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("hex");

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Compara con ADMIN_PASSWORD en tiempo constante (vía HMAC, para no filtrar la longitud). */
export function checkPassword(input: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || expected.length < 12) return false;
  return safeEqual(sign(`pw:${input}`), sign(`pw:${expected}`));
}

/** Cookie firmada: "<expira>.<hmac>". HttpOnly + Secure + SameSite=Strict (protege de CSRF). */
export function sessionCookie(now = Date.now()): string {
  const exp = Math.floor(now / 1000) + MAX_AGE_S;
  return `${COOKIE}=${exp}.${sign(`session:${exp}`)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${MAX_AGE_S}`;
}

export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

export function isLoggedIn(req: Request, now = Date.now()): boolean {
  const raw = req.headers.get("cookie") ?? "";
  const m = raw.match(new RegExp(`(?:^|;\\s*)${COOKIE}=(\\d+)\\.([a-f0-9]{64})`));
  if (!m) return false;
  const [, exp, mac] = m;
  if (Number(exp) * 1000 < now) return false;
  try {
    return safeEqual(mac, sign(`session:${exp}`));
  } catch {
    return false;
  }
}

export const unauthorized = () => Response.json({ error: "No has iniciado sesión" }, { status: 401 });
