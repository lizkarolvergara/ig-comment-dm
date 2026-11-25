import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkPassword, isLoggedIn, sessionCookie } from "../lib/auth.js";
import { validateRule } from "../lib/rules.js";

describe("auth", () => {
  beforeEach(() => {
    process.env.ADMIN_PASSWORD = "una-contraseña-larga-123";
    process.env.SESSION_SECRET = "x".repeat(40);
  });
  afterEach(() => {
    delete process.env.ADMIN_PASSWORD;
    delete process.env.SESSION_SECRET;
  });
  const req = (cookie?: string) => new Request("https://x/api/rules", { headers: cookie ? { cookie } : {} });

  it("valida la contraseña", () => {
    expect(checkPassword("una-contraseña-larga-123")).toBe(true);
    expect(checkPassword("otra")).toBe(false);
    expect(checkPassword("")).toBe(false);
  });
  it("rechaza contraseñas cortas configuradas", () => {
    process.env.ADMIN_PASSWORD = "corta";
    expect(checkPassword("corta")).toBe(false);
  });
  it("acepta la cookie firmada y rechaza la alterada o vencida", () => {
    const c = sessionCookie().split(";")[0];
    expect(isLoggedIn(req(c))).toBe(true);
    expect(isLoggedIn(req(c.replace(/.$/, (ch) => (ch === "a" ? "b" : "a"))))).toBe(false);
    expect(isLoggedIn(req())).toBe(false);
    const old = sessionCookie(Date.now() - 31 * 86400000).split(";")[0];
    expect(isLoggedIn(req(old))).toBe(false);
  });
  it("una cookie de otro secreto no sirve", () => {
    const c = sessionCookie().split(";")[0];
    process.env.SESSION_SECRET = "y".repeat(40);
    expect(isLoggedIn(req(c))).toBe(false);
  });
  it("la cookie es HttpOnly, Secure y SameSite=Strict", () => {
    expect(sessionCookie()).toMatch(/HttpOnly; Secure; SameSite=Strict/);
  });
});

describe("validateRule", () => {
  const ok = { post_url: "https://www.instagram.com/reel/ABC/", keyword: "LUPA, LUPPA", dm_message: "hola https://lupa.art", public_reply: "¡Listo! | ¡Enviado!" };
  it("acepta una regla completa", () => {
    const r = validateRule(ok);
    expect(r.errors).toEqual([]);
    expect(r.value).toMatchObject(ok);
  });
  it("explica qué falta", () => {
    const r = validateRule({ post_url: "https://lupa.art", keyword: " , ", dm_message: "", public_reply: "|" });
    expect(r.errors).toHaveLength(4);
  });
  it("el DM no pasa de 1000 caracteres", () => {
    expect(validateRule({ ...ok, dm_message: "a".repeat(1001) }).errors[0]).toContain("1000");
  });
  it("en edición parcial solo valida lo que llega", () => {
    expect(validateRule({ active: false }, true)).toEqual({ value: { active: false }, errors: [] });
  });
  it("respuesta alternativa vacía = por defecto", () => {
    expect(validateRule({ ...ok, fallback_reply: "  " }).value.fallback_reply).toBeNull();
  });
});
