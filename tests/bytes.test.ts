import assert from "node:assert/strict";
import { test } from "node:test";

import { sniffType, toBase64 } from "../src/core/deltacord/bytes.ts";

test("toBase64 matches Buffer for every padding length", () => {
    for (const len of [0, 1, 2, 3, 4, 5, 10000]) {
        const bytes = Uint8Array.from({ length: len }, (_, i) => (i * 37) & 255);
        assert.equal(toBase64(bytes), Buffer.from(bytes).toString("base64"));
    }
});

test("sniffType recognises common formats", () => {
    assert.equal(sniffType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0])), "image/png");
    assert.equal(sniffType(Uint8Array.from([0xff, 0xd8, 0xff])), "image/jpeg");
    assert.equal(sniffType(new TextEncoder().encode("OggS....")), "audio/ogg");
    assert.equal(sniffType(Uint8Array.from([1, 2, 3, 4]), "x/y"), "x/y");
});
