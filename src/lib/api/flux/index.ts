// shelter-mod inspired
import { FluxDispatcher } from "@metro/common";

const blockedSym = Symbol.for("bunny.flux.blocked");
const modifiedSym = Symbol.for("bunny.flux.modified");

export const dispatcher = FluxDispatcher;

type Intercept = (payload: Record<string, any> & { type: string; }) => any;
let intercepts: Intercept[] = [];

/** How many dispatches went through Deltacord's hook (for Doctor's self-test). */
export const fluxStats = { dispatches: 0, blocked: 0 };

/** What a blocked dispatch becomes: an action nothing in Discord listens to. */
export const BLOCKED_TYPE = "DELTACORD_BLOCKED";

/**
 * @internal
 * Runs the intercepts on every dispatch, by wrapping FluxDispatcher.dispatch. (Discord's own
 * interceptor list isn't reliable across versions; wrapping dispatch is what current mods use.)
 */
export function injectFluxInterceptor() {
    const { before } = require("spitroast");
    return before("dispatch", dispatcher, (args: any[]) => {
        const payload = args[0];
        if (!payload || typeof payload !== "object" || typeof payload.type !== "string" || payload.type === BLOCKED_TYPE) return;
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
            args[0] = { type: BLOCKED_TYPE, original: payload };
        }
    });
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
