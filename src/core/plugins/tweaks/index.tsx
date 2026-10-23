/**
 * Deltacord's everyday tweaks: small, independent fixes with their own switches.
 * Each tweak starts and stops on its own and fails safely (a broken one is just skipped),
 * so one Discord change can't take the others, or Discord, down with it.
 */
import { awaitStorage, createMMKVBackend, createStorage, useProxy, wrapSync } from "@core/vendetta/storage";
import { intercept } from "@lib/api/flux";
import { after, instead } from "@lib/api/patcher";
import { findAssetId } from "@lib/api/assets";
import { openAlert } from "@lib/ui/alerts";
import { constants } from "@metro/common";
import { AlertActionButton, AlertActions, AlertModal, Stack, TableRow, TableRowGroup, TableSwitchRow, Text } from "@metro/common/components";
import { findByName, findByProps, findByStoreNameLazy } from "@metro/wrappers";
import { ScrollView } from "react-native";

import { announceSave } from "@core/deltacord/extras";

import { defineCorePlugin } from "..";

interface Tweak {
    id: string;
    name: string;
    description: string;
    icon: string;
    enabledByDefault: boolean;
    /** Applies the tweak; returns how to undo it. */
    start(): () => void;
}

export const tweakSettings = wrapSync(createStorage<Record<string, boolean>>(createMMKVBackend("DELTACORD_TWEAKS")));

const noop = () => { };
const all = (...undo: Array<(() => unknown) | undefined>) => () => undo.forEach(u => u?.());

// ----------------------------------------------------------------- tweaks

const silentTyping: Tweak = {
    id: "silentTyping",
    name: "Hide that I'm typing",
    description: "Others won't see \"is typing…\" when you type.",
    icon: "KeyboardIcon",
    enabledByDefault: false,
    // Discord's typing store sends the typing signal when it sees TYPING_START_LOCAL.
    start: () => intercept(p => (p.type === "TYPING_START_LOCAL" ? false : undefined)),
};

const noTracking: Tweak = {
    id: "noTracking",
    name: "No tracking",
    description: "Stops Discord's analytics events and crash-report collection.",
    icon: "ShieldIcon",
    enabledByDefault: true,
    start() {
        const undo: Array<() => unknown> = [intercept(p => (p.type === "TRACK" ? false : undefined))];

        for (const props of [["trackWithMetadata"], ["track", "trackMaker"]]) {
            const mod = findByProps(...props);
            for (const key of props) {
                if (typeof mod?.[key] === "function") undo.push(instead(key, mod, noop));
            }
        }

        try {
            const client = (window as any).__SENTRY__?.hub?.getClient?.();
            if (client?.getOptions) {
                const options = client.getOptions();
                const wasEnabled = options.enabled;
                options.enabled = false;
                undo.push(() => void (options.enabled = wasEnabled));
            }
        } catch { }

        return all(...undo);
    },
};

const hideChatButtons: Tweak = {
    id: "hideChatButtons",
    name: "Hide gift & apps buttons",
    description: "Removes the Nitro gift and apps buttons from the chat bar.",
    icon: "GiftIcon",
    enabledByDefault: true,
    start() {
        const undo: Array<() => unknown> = [];
        for (const name of ["ChatInputActionButtonGift", "ChatInputActionButtonApps"]) {
            const mod = findByName(name, false);
            if (typeof mod?.default === "function") undo.push(instead("default", mod, () => null));
        }
        return all(...undo);
    },
};

/** "Oct 22, 2026, 3:04 PM" without relying on Intl being present. */
function fullTime(date: Date) {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const h = date.getHours();
    const hour = h % 12 || 12;
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}, ${hour}:${minutes} ${h < 12 ? "AM" : "PM"}`;
}

const fullTimestamps: Tweak = {
    id: "fullTimestamps",
    name: "Full timestamps",
    description: "Shows the full date and time on messages instead of \"Today at…\".",
    icon: "ClockIcon",
    enabledByDefault: false,
    start() {
        const RowManager = findByName("RowManager");
        if (!RowManager?.prototype?.generate) return noop;
        return after("generate", RowManager.prototype, ([row]: any[], ret: any) => {
            try {
                if (row?.rowType !== 1 || !ret?.message?.timestamp || row.message?.state !== "SENT") return;
                const t = row.message.timestamp;
                const date = new Date(typeof t?.valueOf === "function" ? t.valueOf() : t);
                if (!isNaN(date.getTime())) ret.message.timestamp = fullTime(date);
            } catch { }
        });
    },
};

const showHiddenChannels: Tweak = {
    id: "showHiddenChannels",
    name: "Show hidden channels",
    description: "Lists channels you don't have access to. Tapping one shows its name and topic (you still can't read it).",
    icon: "EyeIcon",
    enabledByDefault: false,
    start() {
        const Permissions = findByProps("getChannelPermissions", "can");
        const ChannelStore = findByStoreNameLazy("ChannelStore");
        const ChannelTypes = findByProps("ChannelTypes")?.ChannelTypes ?? {};
        const VIEW = constants?.Permissions?.VIEW_CHANNEL;
        if (!Permissions?.can || VIEW == null) return noop;

        const skipTypes = [ChannelTypes.DM, ChannelTypes.GROUP_DM, ChannelTypes.GUILD_CATEGORY].filter(t => t != null);
        const REAL = Symbol.for("deltacord.realPermissionCheck");

        const isHidden = (channel: any) => {
            if (!channel || skipTypes.includes(channel.type)) return false;
            channel[REAL] = true;
            try {
                return !Permissions.can(VIEW, channel);
            } finally {
                delete channel[REAL];
            }
        };

        const undo: Array<() => unknown> = [
            after("can", Permissions, ([perm, channel]: any[], res: any) => (perm === VIEW && channel && !channel[REAL] ? true : res)),
        ];

        // Opening a hidden channel would just fail to load; show what we know about it instead.
        const router = findByProps("transitionToGuild");
        if (router) {
            for (const key of Object.keys(router)) {
                if (typeof router[key] !== "function") continue;
                undo.push(instead(key, router, (args: any[], orig: Function) => {
                    try {
                        const id = typeof args[0] === "string" ? args[0].match(/(\d+)$/)?.[1] : undefined;
                        const channel = id ? ChannelStore.getChannel?.(id) : undefined;
                        if (channel && isHidden(channel)) {
                            openAlert(
                                "deltacord-hidden-channel",
                                <AlertModal
                                    title={`#${channel.name}`}
                                    content={`This channel is hidden from you, so its messages can't be read.${channel.topic ? `\n\nTopic: ${channel.topic}` : ""}`}
                                    actions={<AlertActions><AlertActionButton text="OK" variant="primary" /></AlertActions>}
                                />
                            );
                            return {};
                        }
                    } catch { }
                    return orig(...args);
                }));
            }
        }
        return all(...undo);
    },
};

export const TWEAKS: Tweak[] = [noTracking, hideChatButtons, silentTyping, fullTimestamps, showHiddenChannels];

// ---------------------------------------------------------------- runtime

const running = new Map<string, () => void>();
export const runningTweaks = () => TWEAKS.filter(t => running.has(t.id)).map(t => t.name);
let pluginActive = false;

export const isTweakEnabled = (t: Tweak) => tweakSettings[t.id] ?? t.enabledByDefault;

function startTweak(t: Tweak) {
    if (running.has(t.id)) return;
    try {
        running.set(t.id, t.start());
    } catch (e) {
        console.error(`[Tweaks] ${t.name} couldn't start`, e);
    }
}

function stopTweak(t: Tweak) {
    try {
        running.get(t.id)?.();
    } catch (e) {
        console.error(`[Tweaks] ${t.name} couldn't stop cleanly`, e);
    }
    running.delete(t.id);
}

function setTweak(t: Tweak, on: boolean) {
    tweakSettings[t.id] = on;
    announceSave(`${t.name}: ${on ? "on" : "off"}`);
    if (!pluginActive) return;
    on ? startTweak(t) : stopTweak(t);
}

export function TweaksSettings() {
    useProxy(tweakSettings);
    return (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 38 }}>
            <Stack style={{ paddingVertical: 24, paddingHorizontal: 12 }} spacing={16}>
                <TableRowGroup title="Tweaks">
                    {TWEAKS.map(t => {
                        const id = findAssetId(t.icon);
                        return <TableSwitchRow
                            key={t.id}
                            label={t.name}
                            subLabel={t.description}
                            icon={id ? <TableRow.Icon source={id} /> : undefined}
                            value={isTweakEnabled(t)}
                            onValueChange={(v: boolean) => setTweak(t, v)}
                        />;
                    })}
                </TableRowGroup>
                <Text variant="text-xs/medium" color="text-muted">
                    Changes apply right away. If Discord changes something a tweak relies on, that tweak quietly stops working until it's fixed; the others keep going.
                </Text>
            </Stack>
        </ScrollView>
    );
}

export default defineCorePlugin({
    manifest: {
        id: "deltacord.tweaks",
        name: "Deltacord Tweaks",
        version: "1.0.0",
        description: "Everyday fixes with their own switches: no tracking, hide gift buttons, silent typing, full timestamps, hidden channels.",
        authors: [{ name: "Deltacord" }],
    },
    async start() {
        pluginActive = true;
        // Wait for saved switches, so a tweak you turned off never runs, even briefly.
        await awaitStorage(tweakSettings);
        if (!pluginActive) return;
        for (const t of TWEAKS) if (isTweakEnabled(t)) startTweak(t);
    },
    stop() {
        pluginActive = false;
        for (const t of TWEAKS) stopTweak(t);
    },
    SettingsComponent: TweaksSettings,
});
