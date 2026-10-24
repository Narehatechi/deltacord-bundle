/**
 * No Reply Ping: replies start with the "@ mention" switch off, so the person you reply to
 * isn't pinged unless you turn it on for that reply.
 */
import { before } from "@lib/api/patcher";
import { findByProps } from "@metro/wrappers";

import { defineCorePlugin } from "..";

let undo: (() => void) | undefined;

export default defineCorePlugin({
    manifest: {
        id: "deltacord.noreplyping",
        name: "No Reply Ping",
        version: "1.0.0",
        description: "Replies don't ping the person by default (you can still turn the ping on per reply).",
        authors: [{ name: "Deltacord" }],
    },
    start() {
        const replies = findByProps("createPendingReply");
        if (typeof replies?.createPendingReply !== "function") {
            console.error("[No Reply Ping] Couldn't find Discord's reply code");
            return;
        }
        undo = before("createPendingReply", replies, (args: any[]) => {
            if (args[0] && typeof args[0] === "object") args[0].shouldMention = false;
        });
    },
    stop() {
        undo?.();
        undo = undefined;
    },
} as any);
