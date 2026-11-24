/**
 * The safety net put on every hook (see patcher.ts). Kept free of imports so it can be tested
 * on its own.
 */
export type Kind = "before" | "after" | "instead";

/** Told about each failure: what failed, the error, where the hook was made, and whether it stopped. */
export type Report = (where: string, error: unknown, madeAt: Error, stopped: boolean) => void;

/** A hook that fails this many times stops itself until Discord restarts. */
const FAILURES_BEFORE_STOPPING = 3;

/** A short name for what's being hooked, for Doctor ("after render (ErrorBoundary)"). */
function describe(kind: Kind, func: unknown, parent: any): string {
    let owner = "";
    try {
        owner = parent?.displayName ?? parent?.name ?? parent?.constructor?.name ?? "";
        if (owner === "Object" || owner === "Function") owner = "";
    } catch { }
    return `${kind} ${String(func)}${owner ? ` (${owner})` : ""}`;
}

/**
 * The safety net on every hook, Deltacord's own and every plugin's: if the hook throws, Discord
 * carries on as if it weren't there (its own code runs with its own arguments and result). After
 * a few failures the hook stops itself for the rest of the session; it's back on next launch.
 */
export function guardHook(kind: Kind, func: unknown, parent: any, callback: Function, report: Report): Function {
    if (typeof callback !== "function") return callback;
    // Where the hook was made, to tell which plugin it belongs to.
    const madeAt = new Error("hook created here");
    let failures = 0;
    let stopped = false;
    const failed = (error: unknown) => {
        failures++;
        stopped = failures >= FAILURES_BEFORE_STOPPING;
        // Worked out only now: the target may be one of Deltacord's lazy lookups until it loads.
        try {
            report(describe(kind, func, parent), error, madeAt, stopped);
        } catch { }
    };

    if (kind === "instead") {
        return function (this: any, args: any[], original: Function) {
            if (stopped) return original.apply(this, args);
            let called = false;
            let result: unknown;
            const self = this;
            const tracked = function (this: any, ...a: any[]) {
                called = true;
                result = original.apply(this ?? self, a);
                return result;
            };
            try {
                return callback.call(this, args, tracked);
            } catch (error) {
                failed(error);
                // Don't run Discord's code twice if the hook already did.
                return called ? result : original.apply(this, args);
            }
        };
    }
    return function (this: any, ...a: any[]) {
        if (stopped) return undefined;
        try {
            return callback.apply(this, a);
        } catch (error) {
            failed(error);
            // undefined leaves the arguments (before) or the result (after) as Discord had them.
            return undefined;
        }
    };
}

