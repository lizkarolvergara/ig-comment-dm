import { createHmac, timingSafeEqual } from "node:crypto";

/** Verifica X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(cuerpo crudo, app secret). */
export function verifySignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header?.startsWith("sha256=") || !secret) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(rawBody, "utf8").digest("hex"));
  const got = Buffer.from(header.slice(7));
  return got.length === expected.length && timingSafeEqual(got, expected);
}
