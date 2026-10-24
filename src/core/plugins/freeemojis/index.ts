/**
 * Free Emojis: without Nitro, custom emojis from other servers (and animated ones) are sent as
 * small emoji images (links) instead of being refused. With Nitro, nothing changes.
 */
import { instead } from "@lib/api/patcher";
import { findByProps, findByStoreNameLazy } from "@metro/wrappers";

import { defineCorePlugin } from "..";
import { all, onSend } from "../shared";

const UserStore = findByStoreNameLazy("UserStore");
const ChannelStore = findByStoreNameLazy("ChannelStore");

const SIZE = 48;

const hasNitro = () => {
    try {
        return (UserStore.getCurrentUser?.()?.premiumType ?? 0) > 0;
    } catch {
        return false;
    }
};

const emojiUrl = (emoji: any) =>
    `https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? "gif" : "webp"}?size=${SIZE}&quality=lossless&name=${encodeURIComponent(emoji.name ?? "emoji")}`;

let undo: (() => void) | undefined;

export default defineCorePlugin({
    manifest: {
        id: "deltacord.freeemojis",
        name: "Free Emojis",
        version: "1.0.0",
        description: "Without Nitro, emojis from other servers and animated emojis are sent as small emoji images.",
        authors: [{ name: "Deltacord" }],
    },
    start() {
        const parts: Array<() => unknown> = [];

        // Let the emoji picker offer every emoji.
        const perms = findByProps("canUseEmojisEverywhere");
        for (const key of ["canUseEmojisEverywhere", "canUseAnimatedEmojis"]) {
            if (typeof perms?.[key] === "function") parts.push(instead(key, perms, () => true));
        }

        parts.push(onSend((message, channelId) => {
            if (hasNitro()) return;
            const emojis: any[] = Array.isArray(message.validNonShortcutEmojis) ? message.validNonShortcutEmojis : [];
            if (!emojis.length) return;
            const guildId = ChannelStore.getChannel?.(channelId)?.guild_id;

            message.validNonShortcutEmojis = emojis.filter(emoji => {
                if (!emoji?.id) return true; // A normal (Unicode) emoji.
                const usable = emoji.guildId === guildId && !emoji.animated && emoji.available !== false;
                if (usable) return true;
                const tag = new RegExp(`<a?:[^:>\\s]+:${emoji.id}>`, "g");
                message.content = message.content.replace(tag, emojiUrl(emoji));
                return false;
            });
        }));

        undo = all(...parts);
    },
    stop() {
        undo?.();
        undo = undefined;
    },
} as any);
