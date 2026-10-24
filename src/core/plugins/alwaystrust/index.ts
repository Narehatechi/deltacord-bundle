/**
 * Always Trust Links: opens links straight away, without Discord's "Leaving Discord" warning.
 */
import { instead } from "@lib/api/patcher";
import { findByProps, findByStoreName } from "@metro/wrappers";

import { defineCorePlugin } from "..";
import { all } from "../shared";

let undo: (() => void) | undefined;

export default defineCorePlugin({
    manifest: {
        id: "deltacord.alwaystrust",
        name: "Always Trust Links",
        version: "1.0.0",
        description: "Opens links straight away, without the \"Leaving Discord\" warning.",
        authors: [{ name: "Deltacord" }],
    },
    start() {
        const parts: Array<() => unknown> = [];
        const store = findByStoreName("MaskedLinkStore");
        for (const key of ["isTrustedDomain", "isTrustedProtocol"]) {
            if (typeof store?.[key] === "function") parts.push(instead(key, store, () => true));
        }
        const links = findByProps("isLinkTrusted");
        if (typeof links?.isLinkTrusted === "function") parts.push(instead("isLinkTrusted", links, () => true));
        if (!parts.length) console.error("[Always Trust Links] Couldn't find Discord's link check");
        undo = all(...parts);
    },
    stop() {
        undo?.();
        undo = undefined;
    },
} as any);
