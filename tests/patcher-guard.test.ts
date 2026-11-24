import assert from "node:assert/strict";
import { test } from "node:test";

import { guardHook, type Kind } from "../src/lib/api/patchGuard.ts";

const reports: { where: string; message: string; stopped: boolean; }[] = [];
const report = (where: string, error: unknown, _madeAt: Error, stopped: boolean) => reports.push({ where, message: (error as Error).message, stopped });

/** Hooks a method the way spitroast does, with the safety net on. */
function hook(kind: Kind, parent: any, func: string, cb: Function) {
    const safe = guardHook(kind, func, parent, cb, report);
    const orig = parent[func];
    parent[func] = function (this: any, ...args: any[]) {
        if (kind === "before") {
            const r = safe.call(this, args);
            return orig.apply(this, Array.isArray(r) ? r : args);
        }
        if (kind === "after") {
            const ret = orig.apply(this, args);
            const r = safe.call(this, args, ret);
            return r === undefined ? ret : r;
        }
        return safe.call(this, args, orig);
    };
}

test("a hook that throws leaves Discord's own result alone", () => {
    const target = { add: (a: number, b: number) => a + b };
    hook("after", target, "add", () => { throw new Error("boom"); });
    assert.equal(target.add(2, 3), 5);
    assert.deepEqual(reports.find(r => r.message === "boom"), { where: "after add", message: "boom", stopped: false });
});

test("working hooks still work", () => {
    const target = { add: (a: number, b: number) => a + b };
    hook("after", target, "add", (_args: any[], ret: number) => ret * 10);
    hook("before", target, "add", (args: any[]) => [args[0] + 1, args[1]]);
    assert.equal(target.add(2, 3), 60);
});

test("a before hook that throws keeps the arguments", () => {
    const target = { echo: (x: string) => x };
    hook("before", target, "echo", () => { throw new Error("nope"); });
    assert.equal(target.echo("hi"), "hi");
});

test("instead: a throw before calling Discord's code runs it once", () => {
    let calls = 0;
    const target = { go: () => ++calls };
    hook("instead", target, "go", () => { throw new Error("before"); });
    assert.equal(target.go(), 1);
    assert.equal(calls, 1);
});

test("instead: a throw after calling Discord's code doesn't run it twice", () => {
    let calls = 0;
    const target = { go: () => ++calls };
    hook("instead", target, "go", (args: any[], orig: Function) => {
        orig(...args);
        throw new Error("after");
    });
    assert.equal(target.go(), 1);
    assert.equal(calls, 1);
});

test("instead keeps `this`", () => {
    const target = { n: 7, get(this: any) { return this.n; } };
    hook("instead", target, "get", function (this: any, args: any[], orig: Function) { return orig.apply(this, args) + 1; });
    assert.equal(target.get(), 8);
});

test("a hook that keeps failing stops itself", () => {
    let runs = 0;
    const target = { f: () => "ok" };
    hook("after", target, "f", () => {
        runs++;
        throw new Error("again");
    });
    for (let i = 0; i < 6; i++) assert.equal(target.f(), "ok");
    assert.equal(runs, 3);
    assert.equal(reports.filter(r => r.message === "again").at(-1)!.stopped, true);
});
