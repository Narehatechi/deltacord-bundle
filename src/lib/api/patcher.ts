import { guardHook } from "./patchGuard";
import { recordProblem, sourceOf } from "./problems";

const {
    after: _after,
    before: _before,
    instead: _instead
} = require("spitroast");

/** @internal */
export const _patcherDelaySymbol = Symbol.for("bunny.api.patcher.delay");

type Unpatcher = () => boolean;
type DelayCallback = (callback: (target: any) => void) => unknown;
type Thenable = { then: typeof Promise.prototype.then };

interface PatchFn<Callback> {
    (func: string, parent: any, callback: Callback, once?: boolean): Unpatcher;
    await(func: string, parent: Promise<unknown>, callback: Callback, once?: boolean): Unpatcher;
}


type Kind = "before" | "after" | "instead";

type BeforeFn = PatchFn<(args: any[]) => unknown | unknown[]>;
type InsteadFn = PatchFn<(args: any[], origFunc: Function) => unknown>;
type AfterFn = PatchFn<(args: any[], ret: any) => unknown>;

function create(fn: Function, kind: Kind) {
    function patchFn(this: any, ...args: any[]) {
        args[2] = guardHook(kind, args[0], args[1], args[2], (where, error, madeAt, stopped) => recordProblem(where, error, sourceOf(error, madeAt), stopped));
        if (typeof args[1][_patcherDelaySymbol] === "function") {
            const delayCallback: DelayCallback = args[1][_patcherDelaySymbol];

            let cancel = false;
            let unpatch = () => cancel = true;

            delayCallback(target => {
                if (cancel) return;
                args[1] = target;
                // This runs while Discord is loading the module: a patch that can't apply must
                // not throw into Discord (it took whole screens down), so it's skipped instead.
                try {
                    unpatch = fn.apply(this, args);
                } catch (e) {
                    console.error(`[Deltacord] A delayed patch of ${String(args[0])} couldn't apply`, e);
                }
            });

            return () => unpatch();
        }

        return fn.apply(this, args);
    }

    function promisePatchFn(this: any, ...args: [any, Thenable, ...any]) {
        const thenable = args[1];
        if (!thenable || !("then" in thenable)) throw new Error("target is not a then-able object");

        let cancel = false;
        let unpatch = () => cancel = true;

        thenable.then(target => {
            if (cancel) return;
            args[1] = target;
            // patchFn adds the safety net; this callback is the plugin's own.
            unpatch = patchFn.apply(this, args);
        });

        return () => unpatch();
    }

    return Object.assign(patchFn, { await: promisePatchFn });
}

export const after = create(_after, "after") as AfterFn;
export const before = create(_before, "before") as BeforeFn;
export const instead = create(_instead, "instead") as InsteadFn;

/** @internal */
export default { after, before, instead };
