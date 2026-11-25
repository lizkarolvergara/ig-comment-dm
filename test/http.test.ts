import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createIgApi, GraphError } from "../lib/instagram.js";
import { checkTokenHealth, refreshIfNeeded } from "../lib/refresh.js";
import { verifySignature } from "../lib/signature.js";
import { parseCommentsPayload } from "../lib/webhook.js";
import { memoryStore } from "./memory.js";

describe("verifySignature", () => {
  const body = '{"a":1}';
  const sig = "sha256=" + createHmac("sha256", "s3cret").update(body).digest("hex");
  it("acepta firma válida", () => expect(verifySignature(body, sig, "s3cret")).toBe(true));
  it("rechaza firma inválida o ausente", () => {
    expect(verifySignature(body + " ", sig, "s3cret")).toBe(false);
    expect(verifySignature(body, null, "s3cret")).toBe(false);
    expect(verifySignature(body, "sha256=abc", "s3cret")).toBe(false);
  });
});

describe("parseCommentsPayload", () => {
  it("lee el formato de webhooks de Instagram", () => {
    const out = parseCommentsPayload({
      object: "instagram",
      entry: [{ id: "ME", time: 1764090000, changes: [{ field: "comments", value: { id: "C1", text: "LUPA", from: { id: "U1", username: "fan" }, media: { id: "M1", media_product_type: "REELS" } } }] }],
    });
    expect(out).toEqual([{ id: "C1", text: "LUPA", mediaId: "M1", fromId: "U1", username: "fan", createdAt: new Date(1764090000000).toISOString() }]);
  });
  it("ignora otros campos", () => expect(parseCommentsPayload({ object: "instagram", entry: [{ changes: [{ field: "mentions", value: { id: "x" } }] }] })).toEqual([]));
});

describe("createIgApi", () => {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

  it("manda el private reply con recipient.comment_id", async () => {
    const f = vi.fn(async () => json(200, { recipient_id: "U1", message_id: "m1" }));
    await createIgApi(() => "TOK", { fetchImpl: f as any, version: "v25.0" }).sendPrivateReply("ME", "C1", "hola");
    const [url, init] = f.mock.calls[0] as any;
    expect(url).toBe("https://graph.facebook.com/v25.0/ME/messages");
    expect(JSON.parse(init.body)).toEqual({ recipient: { comment_id: "C1" }, message: { text: "hola" } });
    expect(init.headers.Authorization).toBe("Bearer TOK");
  });

  it("reintenta errores temporales con backoff", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(json(500, { error: { message: "oops", code: 2 } }))
      .mockResolvedValueOnce(json(200, { id: "r1" }));
    const r = await createIgApi(() => "T", { fetchImpl: f as any, baseDelayMs: 1 }).replyToComment("C1", "x");
    expect(r).toEqual({ id: "r1" });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("no reintenta errores permanentes", async () => {
    const f = vi.fn(async () => json(400, { error: { message: "Invalid", code: 100 } }));
    await expect(createIgApi(() => "T", { fetchImpl: f as any, baseDelayMs: 1 }).replyToComment("C1", "x")).rejects.toBeInstanceOf(GraphError);
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe("refreshIfNeeded (Instagram Login)", () => {
  beforeEach(() => void (process.env.GRAPH_HOST = "graph.instagram.com"));
  afterEach(() => void delete process.env.GRAPH_HOST);
  const now = new Date("2026-12-01T00:00:00Z");
  it("no renueva si faltan más de 20 días", async () => {
    const { store } = memoryStore([], { token_expires_at: "2027-01-15T00:00:00Z", token_refreshed_at: "2026-11-01T00:00:00Z" });
    expect(((await refreshIfNeeded(store, now)) as any).refreshed).toBe(false);
  });
  it("renueva y guarda la nueva fecha", async () => {
    const { store, state } = memoryStore([], { token_expires_at: "2026-12-10T00:00:00Z", token_refreshed_at: "2026-10-11T00:00:00Z" });
    const f = vi.fn(async () => new Response(JSON.stringify({ access_token: "NEW", token_type: "bearer", expires_in: 5184000 })));
    expect(((await refreshIfNeeded(store, now, f as any)) as any).refreshed).toBe(true);
    expect(state().access_token).toBe("NEW");
    expect(state().token_expires_at).toBe("2027-01-30T00:00:00.000Z");
    expect(String((f.mock.calls[0] as any)[0])).toContain("/refresh_access_token?grant_type=ig_refresh_token&access_token=tok");
  });
  it("guarda el error si falla", async () => {
    const { store, state } = memoryStore([], { token_expires_at: "2026-12-10T00:00:00Z" });
    const f = vi.fn(async () => new Response(JSON.stringify({ error: { message: "expired", code: 190 } }), { status: 400 }));
    expect(((await refreshIfNeeded(store, now, f as any)) as any).refreshed).toBe(false);
    expect(state().last_refresh_error).toContain("expired");
  });
});

describe("Unified login (graph.facebook.com)", () => {
  it("usa graph.facebook.com y /{IG_USER_ID} por defecto", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ id: "1784", username: "liz" })));
    const acc = await createIgApi(() => "T", { fetchImpl: f as any, version: "v25.0" }).account("1784");
    expect(acc).toEqual({ id: "1784", username: "liz" });
    expect((f.mock.calls[0] as any)[0]).toBe("https://graph.facebook.com/v25.0/1784?fields=id,username");
  });
  it("lista media de la cuenta por id", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ data: [] })));
    await createIgApi(() => "T", { fetchImpl: f as any, version: "v25.0" }).recentMedia("1784");
    expect((f.mock.calls[0] as any)[0]).toBe("https://graph.facebook.com/v25.0/1784/media?fields=id,timestamp&limit=25");
  });
  it("el cron diario solo verifica el token y avisa si falla", async () => {
    const { store, state } = memoryStore([]);
    const bad = vi.fn(async () => new Response(JSON.stringify({ error: { message: "Invalid OAuth", code: 190 } }), { status: 400 }));
    expect((await refreshIfNeeded(store, new Date(), bad as any)) as any).toMatchObject({ ok: false });
    expect(state().last_refresh_error).toContain("Invalid OAuth");
    const good = vi.fn(async () => new Response(JSON.stringify({ id: "ME", username: "liz" })));
    expect(await checkTokenHealth(store, good as any)).toMatchObject({ ok: true });
    expect(state().last_refresh_error).toBeNull();
  });
});
