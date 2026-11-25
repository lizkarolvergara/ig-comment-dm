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

  it("si falla el DM, guarda el error y al reintentar solo hace lo que falta", async () => {
    const { store, events } = memoryStore([LUPA]);
    const { ig, calls } = fakeIg({ failDm: 1 });
    expect(await processComment(c("C4", "lupa"), "webhook", { store, ig })).toBe("partial");
    expect(events.get("C4")).toMatchObject({ dm_sent: false, replied: true });
    expect(events.get("C4")?.error).toContain("boom dm");
    expect(await processComment(c("C4", "lupa"), "poll", { store, ig })).toBe("done");
    expect(calls.dm).toEqual(["C4"]);
    expect(calls.reply).toHaveLength(1); // no repite la respuesta pública
    expect(events.get("C4")?.error).toBeNull();
  });

  it("no envía DM si el comentario tiene más de 7 días", async () => {
    const { store, events } = memoryStore([LUPA]);
    const { ig, calls } = fakeIg();
    const old = new Date(Date.now() - 8 * 86400000).toISOString();
    expect(await processComment(c("C5", "lupa", { createdAt: old }), "poll", { store, ig })).toBe("expired");
    expect(calls.dm).toHaveLength(0);
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
