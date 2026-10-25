/**
 * Makes changes show straight away instead of after a reload.
 *
 * - refreshChat(): Discord only redraws a chat row when the message changes, so plugins that
 *   change how messages look (Message Logger, full timestamps, Hidden Channels...) would only
 *   show on messages that arrive later. This redraws the messages already on screen.
 * - refreshProfile(): fetches your profile again with Discord's own code, so a loaded profile
 *   shows everywhere at once.
 */
import { FluxDispatcher } from "@metro/common";
import { findByProps, findByStoreNameLazy } from "@metro/wrappers";

const MessageStore = findByStoreNameLazy("MessageStore");
const SelectedChannelStore = findByStoreNameLazy("SelectedChannelStore");
const ChannelStore = findByStoreNameLazy("ChannelStore");

/** An unused message flag bit; flipping it is a change Discord notices, and nothing else reads it. */
const REDRAW_FLAG = 0x10000000;
/** Only the newest messages: the ones on (or near) the screen. */
const LIMIT = 60;

let timer: ReturnType<typeof setTimeout> | undefined;

/** Redraws the messages in the open chat (batched: several calls in a row redraw once). */
export function refreshChat() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
        timer = undefined;
        try {
            const channelId = SelectedChannelStore.getChannelId?.();
            if (!channelId) return;
            const guildId = ChannelStore.getChannel?.(channelId)?.guild_id;
            const messages = MessageStore.getMessages?.(channelId);
            const list: any[] = messages?._array ?? messages?.toArray?.() ?? [];
            for (const message of list.slice(-LIMIT)) {
                if (!message?.id) continue;
                FluxDispatcher.dispatch({
                    type: "MESSAGE_UPDATE",
                    guildId,
                    message: { id: message.id, channel_id: channelId, guild_id: guildId, flags: (message.flags | 0) ^ REDRAW_FLAG },
                });
            }
        } catch (e) {
            console.error("[Deltacord] Couldn't refresh the chat", e);
        }
    }, 150);
}

/** Fetches a profile again so Discord shows its latest version everywhere. */
export async function refreshProfile(userId: string, guildId?: string) {
    try {
        const profiles = findByProps("fetchProfile");
        await profiles?.fetchProfile?.(userId, { guildId, withMutualGuilds: false, withMutualFriends: false });
    } catch (e) {
        console.warn("[Deltacord] Couldn't refresh the profile", e);
    }
}
