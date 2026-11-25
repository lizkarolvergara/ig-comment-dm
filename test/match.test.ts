import { describe, expect, it } from "vitest";
import { containsKeyword, pickKeyword, pickVariant } from "../lib/match.js";
import { LUPA } from "./memory.js";

describe("containsKeyword", () => {
  it.each(["LUPA", "lupa", "Lúpa", "quiero LUPA!!", "LUPA 🙌", "¿lupa?", "#lupa", "hola\nLupa"])("sí: %s", (t) =>
    expect(containsKeyword(t, "LUPA")).toBe(true),
  );
  it.each(["lupanar", "superlupa", "lup a", "", "l u p a"])("no: %s", (t) => expect(containsKeyword(t, "LUPA")).toBe(false));
  it("palabra clave con tilde", () => expect(containsKeyword("quiero la guia", "guía")).toBe(true));
});

describe("pickKeyword", () => {
  const perPost = { ...LUPA, id: 2, keyword: "PROMO", media_id: "M1" };
  it("la del post aplica solo a ese post", () => {
    expect(pickKeyword("promo", "M1", [LUPA, perPost])?.id).toBe(2);
    expect(pickKeyword("promo", "M2", [LUPA, perPost])).toBeNull();
  });
  it("ignora inactivas", () => expect(pickKeyword("lupa", "M1", [{ ...LUPA, active: false }])).toBeNull());
});

describe("pickVariant", () => {
  it("elige entre variantes separadas por |", () => {
    expect(pickVariant("a | b", () => 0)).toBe("a");
    expect(pickVariant("a | b", () => 0.99)).toBe("b");
    expect(pickVariant("solo una")).toBe("solo una");
  });
});

describe("shortcodeFromUrl", async () => {
  const { shortcodeFromUrl } = await import("../lib/match.js");
  it.each([
    ["https://www.instagram.com/p/DAbc_12-x/", "DAbc_12-x"],
    ["https://instagram.com/reel/XYZ?igsh=abc", "XYZ"],
    ["https://www.instagram.com/hueleanaranjas/p/QQQ/", "QQQ"],
    ["https://www.instagram.com/reels/RRR/", "RRR"],
    ["https://lupa.art", null],
  ])("%s", (u, sc) => expect(shortcodeFromUrl(u)).toBe(sc));
});
