// shelter-mod inspired
import { FluxDispatcher } from "@metro/common";

const blockedSym = Symbol.for("bunny.flux.blocked");
const modifiedSym = Symbol.for("bunny.flux.modified");

export const dispatcher = FluxDispatcher;

type Intercept = (payload: Record<string, any> & { type: string; }) => any;
let intercepts: Intercept[] = [];

/** How many dispatches went through Deltacord's hooks, and by which route (for Doctor's self-test). */
export const fluxStats = { dispatches: 0, blocked: 0, viaDispatch: 0, viaInterceptor: 0 };

/** What a blocked dispatch becomes: an action nothing in Discord listens to. */
export const BLOCKED_TYPE = "DELTACORD_BLOCKED";

const seenSym = Symbol.for("deltacord.flux.seen");

/** Runs every intercept once per action. Returns whether it should be blocked. */
function run(payload: any): boolean {
    if (payload[seenSym]) return payload[blockedSym] === true;
    payload[seenSym] = true;
    fluxStats.dispatches++;
    let blocked = false;
    for (const intercept of intercepts) {
        let res: any;
        try {
            res = intercept(payload);
        } catch (e) {
            console.error("[Flux] An intercept failed", e);
            continue;
        }
        // nullish -> nothing, falsy -> block, object -> modify
        if (res == null) continue;
        if (!res) blocked = true;
        else if (typeof res === "object") {
            Object.assign(payload, res);
            payload[modifiedSym] = true;
        }
    }
    if (blocked) {
        payload[blockedSym] = true;
        fluxStats.blocked++;
    }
    return blocked;
}

const isAction = (payload: any) =>
    !!payload && typeof payload === "object" && typeof payload.type === "string" && payload.type !== BLOCKED_TYPE;

/**
 * @internal
 * Runs the intercepts on every action, two ways, each action once:
 * - wrapping FluxDispatcher.dispatch (what current mods use; lets an action be swapped out),
 * - Discord's own interceptor list, which sees every action however it was sent, including
 *   ones from the connection to Discord's servers that don't go through `dispatch` (messages
 *   from other people, their deletes and edits).
 */
export function injectFluxInterceptor() {
    const { before } = require("spitroast");
    const unpatch = before("dispatch", dispatcher, (args: any[]) => {
        const payload = args[0];
        if (!isAction(payload)) return;
        fluxStats.viaDispatch++;
        if (run(payload)) args[0] = { type: BLOCKED_TYPE, original: payload };
    });

    // Discord's interceptors: returning true stops the action.
    const interceptor = (payload: any) => {
        if (!isAction(payload)) return false;
        if (!payload[seenSym]) fluxStats.viaInterceptor++;
        return run(payload);
    };
    let added = false;
    try {
        if (Array.isArray(dispatcher._interceptors)) {
            dispatcher._interceptors.unshift(interceptor);
            added = true;
        } else if (typeof (dispatcher as any).addInterceptor === "function") {
            (dispatcher as any).addInterceptor(interceptor);
            added = true;
        }
    } catch (e) {
        console.error("[Flux] Couldn't add Discord interceptor", e);
    }

    return () => {
        unpatch();
        if (added && Array.isArray(dispatcher._interceptors)) {
            dispatcher._interceptors = dispatcher._interceptors.filter(i => i !== interceptor);
        }
    };
}

/**
 * Intercept Flux dispatches. Return type affects the end result, where
 * nullish -> nothing, falsy -> block, object -> modify
 */
export function intercept(cb: Intercept) {
    intercepts.push(cb);

    return () => {
        intercepts = intercepts.filter(i => i !== cb);
    };
}
