import assert from "node:assert/strict";
import { test } from "node:test";

import { chunkText, languageCode, splitSegments, translate } from "../src/core/plugins/translate/engine.ts";

const fake = (log: string[], fail = false) => async (url: string) => {
    const q = decodeURIComponent(url.split(/[?&]q=|\/(?=[^/]*$)/).pop()!);
    log.push(url.includes("lingva") ? "lingva" : "google");
    return {
        ok: !(fail && url.includes("google")),
        status: fail && url.includes("google") ? 500 : 200,
        json: async () => (url.includes("lingva") ? { translation: `[${q}]`, info: { detectedSource: "es" } } : [[[`[${q}]`]], null, "es"]),
    };
};

test("languageCode", () => {
    assert.equal(languageCode("Spanish"), "es");
    assert.equal(languageCode("pt-br"), "pt-BR");
    assert.equal(languageCode("", "fr"), "fr");
});

test("splitSegments protects links, mentions, emoji and code", () => {
    const keep = splitSegments("hola <@123> mira https://a.com/x?y=1 `code` <:cat:9> adiós").filter(s => s.keep).map(s => s.text);
    assert.deepEqual(keep, ["<@123>", "https://a.com/x?y=1", "`code`", "<:cat:9>"]);
});

test("chunkText keeps every character and respects the limit", () => {
    const text = "Una frase. ".repeat(300);
    const chunks = chunkText(text, 200);
    assert.equal(chunks.join(""), text);
    assert.ok(chunks.every(c => c.length <= 200));
});

test("translate leaves protected parts and spacing alone", async () => {
    const log: string[] = [];
    const r = await translate("hola <@123> amigo", "en", "auto", fake(log) as any);
    assert.equal(r.text, "[hola] <@123> [amigo]");
    assert.equal(r.from, "es");
});

test("translate falls back to Lingva when Google fails", async () => {
    const log: string[] = [];
    const r = await translate("hola", "en", "auto", fake(log, true) as any);
    assert.equal(r.text, "[hola]");
    assert.deepEqual(log, ["google", "lingva"]);
});
