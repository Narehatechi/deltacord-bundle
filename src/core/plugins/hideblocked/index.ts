/**
 * Hide Blocked Messages: messages from people you've blocked disappear completely, instead of
 * the "1 blocked message" bar.
 */
import { intercept } from "@lib/api/flux";
import { findByStoreNameLazy } from "@metro/wrappers";

import { defineCorePlugin } from "..";

const RelationshipStore = findByStoreNameLazy("RelationshipStore");

const isBlocked = (message: any) => {
    const id = message?.author?.id;
    try {
        return !!id && RelationshipStore.isBlocked?.(id) === true;
    } catch {
        return false;
    }
};

let undo: (() => void) | undefined;

export default defineCorePlugin({
    manifest: {
        id: "deltacord.hideblocked",
        name: "Hide Blocked Messages",
        version: "1.0.0",
        description: "Messages from people you've blocked disappear completely, instead of showing a \"blocked message\" bar.",
        authors: [{ name: "Deltacord" }],
    },
    start() {
        undo = intercept(payload => {
            try {
                if (payload.type === "MESSAGE_CREATE" || payload.type === "MESSAGE_UPDATE") {
                    return isBlocked(payload.message) ? false : undefined;
                }
                // LOAD_MESSAGES_SUCCESS, LOAD_MESSAGES_AROUND_SUCCESS...: drop them from the batch.
                if (payload.type.startsWith("LOAD_MESSAGES") && Array.isArray(payload.messages)) {
                    const kept = payload.messages.filter((m: any) => !isBlocked(m));
                    if (kept.length !== payload.messages.length) return { messages: kept };
                }
            } catch { }
            return undefined;
        });
    },
    stop() {
        undo?.();
        undo = undefined;
    },
} as any);
