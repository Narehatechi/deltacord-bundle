import assert from "node:assert/strict";
import { test } from "node:test";

import { ago, dayOf, describeChange, lifetime, topOf, wordDiff } from "../src/core/plugins/deltalogger/diff.ts";

const join = (pieces: { text: string; kind: string; }[], ...kinds: string[]) =>
    pieces.filter(p => kinds.includes(p.kind)).map(p => p.text).join("");

test("wordDiff gives both versions back exactly", () => {
    const cases: [string, string][] = [
        ["I love cats", "I love dogs"],
        ["hello", "hello world"],
        ["one two three four", "one three"],
        ["", "brand new"],
        ["all gone", ""],
        ["same text", "same text"],
        ["line one\nline two", "line one\nline 2 now"],
        ["  spaced   out  ", "spaced out"],
    ];
    for (const [before, after] of cases) {
        const pieces = wordDiff(before, after);
        assert.equal(join(pieces, "same", "removed").replace(/\s+/g, " ").trim(), before.replace(/\s+/g, " ").trim());
        assert.equal(join(pieces, "same", "added").replace(/\s+/g, " ").trim(), after.replace(/\s+/g, " ").trim());
    }
});

test("wordDiff marks only the words that changed", () => {
    const pieces = wordDiff("I love cats a lot", "I love dogs a lot");
    assert.deepEqual(pieces.filter(p => p.kind === "removed").map(p => p.text.trim()), ["cats"]);
    assert.deepEqual(pieces.filter(p => p.kind === "added").map(p => p.text.trim()), ["dogs"]);
    assert.equal(wordDiff("same", "same").every(p => p.kind === "same"), true);
    assert.deepEqual(wordDiff("", ""), []);
});

test("wordDiff gives up politely on very long messages", () => {
    const long = "word ".repeat(600);
    const pieces = wordDiff(long, "short");
    assert.deepEqual(pieces.map(p => p.kind), ["removed", "added"]);
});

test("describeChange", () => {
    assert.equal(describeChange("I love cats", "I love dogs"), "− cats\n+ dogs");
    assert.equal(describeChange("hello", "hello world"), "+ world");
    assert.equal(describeChange("same", "same"), "");
});

test("lifetime and ago", () => {
    assert.equal(lifetime(400), "1s");
    assert.equal(lifetime(12_000), "12s");
    assert.equal(lifetime(4 * 60_000), "4m");
    assert.equal(lifetime(2 * 3_600_000), "2h");
    assert.equal(lifetime(3 * 86_400_000), "3d");
    assert.equal(lifetime(NaN), "");
    const now = new Date(2026, 10, 24, 12, 0, 0).getTime();
    assert.equal(ago(now - 10_000, now), "just now");
    assert.equal(ago(now - 5 * 60_000, now), "5m ago");
    assert.equal(ago(now - 3 * 3_600_000, now), "3h ago");
    assert.equal(ago(new Date(2026, 0, 2).getTime(), now), "1/2/2026");
    assert.equal(ago(0, now), "");
});

test("dayOf", () => {
    const now = new Date(2026, 10, 24, 0, 30, 0).getTime();
    assert.equal(dayOf(now - 10 * 60_000, now), "Today");
    assert.equal(dayOf(now - 60 * 60_000, now), "Yesterday");
    assert.equal(dayOf(new Date(2026, 10, 1, 9).getTime(), now), "11/1/2026");
});

test("topOf", () => {
    assert.deepEqual(topOf(["a", "b", "a", "c", "b", "a"], 2), [["a", 3], ["b", 2]]);
    assert.deepEqual(topOf([]), []);
});
