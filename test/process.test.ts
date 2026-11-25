import { describe, expect, it } from "vitest";
import { processComment } from "../lib/process.js";
import { pollMedia } from "../lib/poll.js";
import { LUPA, fakeIg, memoryStore } from "./memory.js";

const c = (id: string, text: string, extra: object = {}) => ({ id, text, mediaId: "M1", fromId: "U1", username: "fan", ...extra });

describe("processComment", () => {
  it("envía DM y respuesta pública una sola vez", async () => {
    const { store, events } = memoryStore([LUPA]);
    const { ig, calls } = fakeIg();
    expect(await processComment(c("C1", "LUPA porfa"), "webhook", { store, ig })).toBe("done");
    expect(await processComment(c("C1", "LUPA porfa"), "poll", { store, ig })).toBe("duplicate");
    expect(calls.dm).toEqual(["C1"]);
    expect(calls.reply).toHaveLength(1);
    expect(events.get("C1")).toMatchObject({ matched: true, dm_sent: true, replied: true, error: null, dm_message_id: "m_C1" });
  });

  it("ignora mis propios comentarios", async () => {
    const { store, events } = memoryStore([LUPA]);
    const { ig, calls } = fakeIg();
    expect(await processComment(c("C2", "LUPA", { fromId: "ME" }), "webhook", { store, ig })).toBe("self");
    expect(calls.dm).toHaveLength(0);
    expect(events.size).toBe(0);
  });

  it("registra comentarios sin palabra clave sin responder", async () => {
    const { store, events } = memoryStore([LUPA]);
    const { ig, calls } = fakeIg();
    expect(await processComment(c("C3", "qué lindo"), "webhook", { store, ig })).toBe("no-match");
    expect(events.get("C3")?.matched).toBe(false);
    expect(calls.dm).toHaveLength(0);
  });

  it("si el DM falla por algo temporal, no responde en público hasta resolverlo", async () => {
    const { store, events } = memoryStore([LUPA]);
    const { ig, calls } = fakeIg({ failDm: 1 });
    expect(await processComment(c("C4", "lupa"), "webhook", { store, ig })).toBe("partial");
    expect(events.get("C4")).toMatchObject({ dm_sent: false, replied: false });
    expect(events.get("C4")?.error).toContain("boom dm");
    expect(await processComment(c("C4", "lupa"), "poll", { store, ig })).toBe("done");
    expect(calls.dm).toEqual(["C4"]);
    expect(calls.reply).toEqual([{ id: "C4", text: LUPA.public_reply }]);
    expect(events.get("C4")?.error).toBeNull();
  });

  it("si el DM no se puede entregar, responde con la alternativa y no reintenta", async () => {
    const { GraphError } = await import("../lib/instagram.js");
    const { store, events } = memoryStore([{ ...LUPA, fallback_reply: "Escríbeme primero 💌" }]);
    const { ig, calls } = fakeIg();
    ig.sendPrivateReply = async () => {
      throw new GraphError("This person isn't available right now (code 551)", 400, 551);
    };
    expect(await processComment(c("C7", "lupa"), "poll", { store, ig })).toBe("fallback");
    expect(calls.reply).toEqual([{ id: "C7", text: "Escríbeme primero 💌" }]);
    expect(events.get("C7")).toMatchObject({ dm_sent: false, dm_undeliverable: true, replied: true });
    expect(events.get("C7")?.error).toContain("551");
    expect(await processComment(c("C7", "lupa"), "poll", { store, ig })).toBe("duplicate");
  });

  it("usa la alternativa por defecto si la regla no tiene una", async () => {
    const { GraphError } = await import("../lib/instagram.js");
    const { DEFAULT_FALLBACK_REPLY } = await import("../lib/process.js");
    const { store } = memoryStore([LUPA]);
    const { ig, calls } = fakeIg();
    ig.sendPrivateReply = async () => {
      throw new GraphError("x", 400, 10);
    };
    await processComment(c("C8", "lupa"), "poll", { store, ig });
    expect(DEFAULT_FALLBACK_REPLY.split("|").map((t) => t.trim())).toContain(calls.reply[0].text);
  });

  it("no envía DM si el comentario tiene más de 7 días", async () => {
    const { store, events } = memoryStore([LUPA]);
    const { ig, calls } = fakeIg();
    const old = new Date(Date.now() - 8 * 86400000).toISOString();
    expect(await processComment(c("C5", "lupa", { createdAt: old }), "poll", { store, ig })).toBe("expired");
    expect(calls.dm).toHaveLength(0);
    expect(calls.reply).toHaveLength(1); // responde con la alternativa
    expect(events.get("C5")?.error).toContain("7 días");
  });

  it("dos procesos a la vez no envían dos DMs", async () => {
    const { store } = memoryStore([LUPA]);
    const { ig, calls } = fakeIg();
    await Promise.all([
      processComment(c("C6", "lupa"), "webhook", { store, ig }),
      processComment(c("C6", "lupa"), "poll", { store, ig }),
    ]);
    expect(calls.dm).toEqual(["C6"]);
  });
});

describe("pollMedia", () => {
  it("procesa comentarios y respuestas del post, y salta los ya completos", async () => {
    const { store } = memoryStore([LUPA]);
    const { ig, calls } = fakeIg({
      comments: {
        M1: [
          { id: "A", text: "LUPA", from: { id: "U1", username: "a" }, replies: { data: [{ id: "B", text: "lupa también", from: { id: "U2" } }, { id: "R", text: "¡Te lo envié!", from: { id: "ME" } }] } },
          { id: "D", text: "hola", from: { id: "U3" } },
        ],
      },
    });
    await pollMedia("M1", { store, ig });
    await pollMedia("M1", { store, ig });
    expect(calls.dm.sort()).toEqual(["A", "B"]);
  });
});

describe("loadDeps", () => {
  const withFetch = async (body: object, fn: () => Promise<void>) => {
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify(body))) as any;
    try { await fn(); } finally { globalThis.fetch = orig; }
  };
  it("Unified login: usa el token del entorno sin guardarlo y registra la cuenta", async () => {
    const { loadDeps } = await import("../lib/context.js");
    const { store, state } = memoryStore([LUPA], { access_token: null, ig_user_id: null, ig_username: null });
    process.env.IG_ACCESS_TOKEN = "SUAT";
    process.env.IG_USER_ID = "1784";
    try {
      await withFetch({ id: "1784", username: "hueleanaranjas" }, async () => void (await loadDeps(store)));
    } finally {
      delete process.env.IG_ACCESS_TOKEN;
      delete process.env.IG_USER_ID;
    }
    expect(state()).toMatchObject({ access_token: null, ig_user_id: "1784", ig_username: "hueleanaranjas" });
  });
  it("Instagram Login: guarda IG_ACCESS_TOKEN la primera vez", async () => {
    const { loadDeps } = await import("../lib/context.js");
    const { store, state } = memoryStore([LUPA], { access_token: null, ig_user_id: null });
    process.env.IG_ACCESS_TOKEN = "ENV_TOK";
    process.env.GRAPH_HOST = "graph.instagram.com";
    try {
      await withFetch({ user_id: "ME2", username: "liz" }, async () => void (await loadDeps(store)));
    } finally {
      delete process.env.IG_ACCESS_TOKEN;
      delete process.env.GRAPH_HOST;
    }
    expect(state()).toMatchObject({ access_token: "ENV_TOK", ig_user_id: "ME2", ig_username: "liz" });
  });
});

describe("pollRecent", () => {
  const { pollRecent } = await_import();
  function await_import() {
    return { pollRecent: async (...a: Parameters<typeof import("../lib/poll.js").pollRecent>) => (await import("../lib/poll.js")).pollRecent(...a) };
  }
  const now = new Date("2026-11-25T18:00:00Z");
  const recent = "2026-11-25T17:00:00Z";
  const old = "2026-10-01T00:00:00Z";

  it("responde a comentarios nuevos en posts antiguos, pero no a comentarios viejos", async () => {
    const { store } = memoryStore([LUPA]);
    const { ig, calls } = fakeIg({
      media: [{ id: "OLDPOST", timestamp: "2025-01-01T00:00:00Z", comments_count: 2 }],
      comments: { OLDPOST: [{ id: "NEW", text: "LUPA", timestamp: recent, from: { id: "U1" } }, { id: "OLD", text: "LUPA", timestamp: old, from: { id: "U2" } }] },
    });
    await pollRecent({ store, ig }, now);
    expect(calls.dm).toEqual(["NEW"]);
    expect(calls.reply.map((r) => r.id)).toEqual(["NEW"]);
  });

  it("no relee un post si no cambió su número de comentarios", async () => {
    const { store } = memoryStore([LUPA]);
    const { ig, calls } = fakeIg({ media: [{ id: "P", timestamp: recent, comments_count: 1 }], comments: { P: [{ id: "C", text: "hola", timestamp: recent }] } });
    await pollRecent({ store, ig }, now);
    await pollRecent({ store, ig }, now);
    expect(calls.scanned).toEqual(["P"]);
  });

  it("relee un post con envíos pendientes aunque no cambie el número", async () => {
    const { store } = memoryStore([LUPA]);
    const { ig, calls } = fakeIg({ failDm: 1, media: [{ id: "P", timestamp: recent, comments_count: 1 }], comments: { P: [{ id: "C", text: "lupa", timestamp: recent, from: { id: "U" } }] } });
    await pollRecent({ store, ig }, now);
    await pollRecent({ store, ig }, now);
    expect(calls.scanned).toEqual(["P", "P"]);
    expect(calls.dm).toEqual(["C"]);
  });
});

describe("reglas por post", () => {
  const now = new Date("2026-11-25T18:00:00Z");
  const recent = "2026-11-25T17:00:00Z";
  const rule = (id: number, post_url: string, dm: string) => ({ ...LUPA, id, post_url, media_id: null, dm_message: dm });

  it("misma palabra, mensaje distinto según el post; posts sin regla se ignoran", async () => {
    const { pollRecent } = await import("../lib/poll.js");
    const kws = [rule(10, "https://www.instagram.com/p/AAA/", "msg A"), rule(11, "https://www.instagram.com/reel/BBB/?igsh=x", "msg B")];
    const { store, events } = memoryStore(kws);
    const sent: Record<string, string> = {};
    const { ig } = fakeIg({
      shortcodes: { AAA: "MA", BBB: "MB" },
      media: [{ id: "MA", timestamp: recent, comments_count: 1 }, { id: "MB", timestamp: recent, comments_count: 1 }, { id: "MC", timestamp: recent, comments_count: 1 }],
      comments: {
        MA: [{ id: "c1", text: "LUPA", timestamp: recent, from: { id: "U1" } }],
        MB: [{ id: "c2", text: "lupa", timestamp: recent, from: { id: "U2" } }],
        MC: [{ id: "c3", text: "LUPA", timestamp: recent, from: { id: "U3" } }],
      },
    });
    const orig = ig.sendPrivateReply;
    ig.sendPrivateReply = async (u, id, text) => ((sent[id] = text), orig(u, id, text));
    await pollRecent({ store, ig }, now);
    expect(sent).toEqual({ c1: "msg A", c2: "msg B" });
    expect(events.has("c3")).toBe(false);
    expect(kws.map((k) => k.media_id)).toEqual(["MA", "MB"]);
  });

  it("guarda un error si el link no es de tu cuenta, sin romper el resto", async () => {
    const { pollRecent } = await import("../lib/poll.js");
    const kws = [rule(12, "https://www.instagram.com/p/ZZZ/", "x")];
    const { store } = memoryStore(kws);
    const { ig } = fakeIg();
    await pollRecent({ store, ig }, now);
    expect((kws[0] as any).resolve_error).toContain("No encontré");
  });
});
