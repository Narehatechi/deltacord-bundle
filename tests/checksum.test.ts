import assert from "node:assert/strict";
import { test } from "node:test";

import { checksum, checksumFiles } from "../src/core/deltacord/checksum.ts";

test("checksum is stable and sensitive to changes", () => {
    assert.equal(checksum("abc"), checksum("abc"));
    assert.notEqual(checksum("abc"), checksum("abd"));
});

test("checksumFiles ignores key order but not content", () => {
    assert.equal(checksumFiles({ a: "1", b: "2" }), checksumFiles({ b: "2", a: "1" }));
    assert.notEqual(checksumFiles({ a: "1" }), checksumFiles({ a: "2" }));
});
