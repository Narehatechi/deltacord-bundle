/**
 * Show Hidden Channels: lists the channels you can't see, marked with a lock. Opening one shows
 * what's known about it (name, topic, when it was made, when it was last used) instead of a chat
 * that can never load.
 *
 * How: Discord asks "can I view this channel?" to build the channel list; the answer is yes for
 * the list. Deltacord's own check (`isHidden`) still gets the real answer, and so does everything
 * that would try to load the channel's messages.
 */
import { after, instead } from "@lib/api/patcher";
import { findAssetId } from "@lib/api/assets";
import { constants } from "@metro/common";
import { Stack, Text } from "@metro/common/components";
import { findByName, findByProps, findByStoreName, findByStoreNameLazy } from "@metro/wrappers";
import { Image, ScrollView, View } from "react-native";

import { defineCorePlugin } from "..";
import { all, shortDate, snowflakeDate } from "../shared";

const ChannelStore = findByStoreNameLazy("ChannelStore");

let permissions: any;
let VIEW: any;
let skipTypes: number[] = [];
/** True while Deltacord asks for the real answer. */
let realCheck = false;
let undoAll: (() => void) | undefined;

export function isHidden(channel: any): boolean {
    if (!channel || !permissions?.can || VIEW == null || skipTypes.includes(channel.type)) return false;
    // Threads follow their parent channel.
    realCheck = true;
    try {
        return !permissions.can(VIEW, channel);
    } catch {
        return false;
    } finally {
        realCheck = false;
    }
}

const channelOf = (idOrChannel: any) =>
    typeof idOrChannel === "string" ? ChannelStore.getChannel?.(idOrChannel) : idOrChannel;

function HiddenChannel({ channel }: { channel: any; }) {
    const lock = findAssetId("LockIcon");
    const created = snowflakeDate(channel?.id);
    const lastUsed = snowflakeDate(channel?.lastMessageId ?? channel?.last_message_id);
    return (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 24 }}>
            <Stack spacing={12} style={{ alignItems: "center" }}>
                {lock ? <Image source={lock} style={{ width: 48, height: 48, tintColor: "#FFFFFF" }} /> : null}
                <Text variant="heading-xl/bold" style={{ textAlign: "center" }}>#{channel?.name ?? "hidden"}</Text>
                <Text variant="text-md/medium" color="text-muted" style={{ textAlign: "center" }}>
                    This channel is hidden from you, so its messages can't be read.
                </Text>
                <View style={{ height: 8 }} />
                {channel?.topic ? (
                    <Text variant="text-md/normal" style={{ textAlign: "center" }}>Topic: {channel.topic}</Text>
                ) : null}
                <Text variant="text-sm/medium" color="text-muted">Created {shortDate(created)}</Text>
                {lastUsed ? <Text variant="text-sm/medium" color="text-muted">Last message {shortDate(lastUsed)}</Text> : null}
                {channel?.nsfw ? <Text variant="text-sm/medium" color="text-muted">Age-restricted</Text> : null}
            </Stack>
        </ScrollView>
    );
}

export default defineCorePlugin({
    manifest: {
        id: "deltacord.hiddenchannels",
        name: "Show Hidden Channels",
        version: "2.0.0",
        description: "Lists channels you can't see. Opening one shows its name, topic and when it was last used.",
        authors: [{ name: "Deltacord" }],
    },
    start() {
        permissions = findByProps("getChannelPermissions", "can") ?? findByStoreName("PermissionStore");
        VIEW = constants?.Permissions?.VIEW_CHANNEL;
        const types = findByProps("ChannelTypes")?.ChannelTypes ?? {};
        skipTypes = [types.DM, types.GROUP_DM, types.GUILD_CATEGORY].filter((t: any) => t != null);
        if (!permissions?.can || VIEW == null) {
            console.error("[Hidden Channels] Couldn't find Discord's permission check");
            return;
        }

        const undo: Array<() => unknown> = [];
        // The channel list: hidden channels show up.
        undo.push(after("can", permissions, ([perm, channel]: any[], res: any) =>
            (!realCheck && perm === VIEW && channel ? true : res)));

        // Never ask the server for messages it won't give (that just errors and spins).
        const fetchers = [findByProps("fetchMessages", "sendMessage"), findByProps("stores", "fetchMessages")];
        for (const fetcher of new Set(fetchers.filter(Boolean))) {
            if (typeof fetcher.fetchMessages !== "function") continue;
            undo.push(instead("fetchMessages", fetcher, (args: any[], orig: Function) => {
                const id = args[0]?.channelId ?? args[0];
                if (isHidden(channelOf(id))) return Promise.resolve();
                return orig(...args);
            }));
        }

        // The chat screen: show the hidden channel's details instead of messages.
        let replacedScreen = false;
        for (const name of ["MessagesWrapperConnected", "MessagesWrapper", "ChannelMessages"]) {
            const mod = findByName(name, false);
            if (typeof mod?.default !== "function") continue;
            undo.push(instead("default", mod, (args: any[], orig: Function) => {
                const channel = channelOf(args[0]?.channel ?? args[0]?.channelId);
                if (channel && isHidden(channel)) return <HiddenChannel channel={channel} />;
                return orig(...args);
            }));
            replacedScreen = true;
            break;
        }
        if (!replacedScreen) console.error("[Hidden Channels] Couldn't find the chat screen; hidden channels open empty");

        undoAll = all(...undo);
    },
    stop() {
        undoAll?.();
        undoAll = undefined;
    },
});
