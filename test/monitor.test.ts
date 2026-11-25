import { describe, expect, it } from "vitest";
import { summarizePending } from "../lib/monitor.js";
import { MAX_ATTEMPTS, processComment } from "../lib/process.js";
import type { EventRow } from "../lib/store.js";
import { LUPA, fakeIg, memoryStore } from "./memory.js";

const now = new Date("2026-11-25T12:00:00Z");
const ev = (id: string, p: Partial<EventRow>): EventRow => ({
  comment_id: id, media_id: "M1", ig_user_id: "U", username: "fan", text: "lupa", source: "poll",
  comment_created_at: "2026-11-25T11:00:00Z", matched: true, keyword_id: LUPA.id,
  dm_sent: false, dm_undeliverable: false, replied: false, attempts: 1, error: null, ...p,
});
const rule = { ...LUPA, media_id: "M1", post_url: "https://www.instagram.com/reel/ABC/" };

describe("summarizePending", () => {
  it("clasifica, agrupa por post y deja fuera lo completo", () => {
    const groups = summarizePending(
      [
        ev("done", { dm_sent: true, replied: true }),
        ev("nomatch", { matched: false }),
        ev("fresh", {}),
        ev("retry", { error: "DM: boom" }),
        ev("gaveup", { attempts: MAX_ATTEMPTS, error: "Respuesta pública: boom", dm_sent: true }),
        ev("nodm", { replied: true, dm_undeliverable: true, error: "DM: 551" }),
        ev("old", { comment_created_at: "2026-11-10T00:00:00Z" }),
        ev("oldnodm", { replied: true, dm_undeliverable: true, comment_created_at: "2026-11-10T00:00:00Z" }),
        ev("other", { media_id: "M2", error: "x" }),
      ],
      [rule],
      now,
    );
    const all = groups.flatMap((g) => g.items.map((i) => [i.comment_id, i.status, i.canRetry]));
    expect(all).toEqual(expect.arrayContaining([
      ["fresh", "en-curso", false],
      ["retry", "reintentando", true],
      ["gaveup", "fallo", true],
      ["nodm", "sin-dm", false],
      ["old", "vencido", false],
    ]));
    expect(all.map((x) => x[0])).not.toContain("done");
    expect(all.map((x) => x[0])).not.toContain("oldnodm");
    expect(groups[0]).toMatchObject({ media_id: "M1", post_url: rule.post_url, keyword: "LUPA" });
    expect(groups[0].items[0].comment_id).toBe("gaveup"); // lo que falló va primero
    expect(groups[0].items.find((i) => i.comment_id === "gaveup")!.reason).toContain("Falta la respuesta pública");
    expect(groups[0].items.find((i) => i.comment_id === "retry")!.hoursLeft).toBe(7 * 24 - 1);
  });

  it("no ofrece reintentar si la regla está desactivada", () => {
    const [g] = summarizePending([ev("x", { attempts: MAX_ATTEMPTS, error: "boom" })], [{ ...rule, active: false }], now);
    expect(g.items[0].canRetry).toBe(false);
  });
});

describe("aviso y reintento", () => {
  it("avisa una sola vez cuando se rinde, y se puede reintentar", async () => {
    const { store, events } = memoryStore([LUPA]);
    const { ig, calls } = fakeIg({ failReply: 100 });
    const alerts: string[] = [];
    const deps = { store, ig, alert: async (m: string) => void alerts.push(m) };
    const c = { id: "C1", text: "lupa", mediaId: "M1", fromId: "U1", username: "fan" };
    for (let i = 0; i < MAX_ATTEMPTS + 2; i++) await processComment(c, "poll", deps);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toContain("@fan");
    expect(events.get("C1")).toMatchObject({ dm_sent: true, replied: false });

    ig.replyToComment = async (id, text) => (calls.reply.push({ id, text }), { id: "r" });
    expect(await store.resetEvent("C1")).toBe(true);
    expect(await processComment(c, "poll", deps)).toBe("done");
    expect(calls.dm).toEqual(["C1"]); // el DM no se repite
    expect(await store.resetEvent("C1")).toBe(false); // ya respondido
  });
});
