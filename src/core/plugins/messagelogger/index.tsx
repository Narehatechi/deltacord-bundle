import { useProxy } from "@core/vendetta/storage";
import { pluginSettings } from "@lib/addons/plugins";
import { awaitStorage } from "@lib/api/storage";
import { findAssetId } from "@lib/api/assets";
import { openAlert } from "@lib/ui/alerts";
import { showToast } from "@lib/ui/toasts";
import { clipboard, NavigationNative } from "@metro/common";
import { findByStoreNameLazy } from "@metro/wrappers";
import { AlertActionButton, AlertActions, AlertModal, Stack, TableRow, TableRowGroup, TableSwitchRow } from "@metro/common/components";
import { useEffect, useState } from "react";
import { ScrollView } from "react-native";

import { announceSave } from "@core/deltacord/extras";
import { startingInSafeMode } from "@core/deltacord/safeModeGate";

import { defineCorePlugin } from "..";
import LogBrowser, { exportLogsText } from "./browser";
import { clearAllLogs, interceptMessages, stats } from "./logger";
import { patchRows, rowManagerFound, rowsStyledCount } from "./rows";
import { counts, getSettings, KEEP_DAYS_CHOICES, loadLogs, MAX_LOGS_CHOICES, saveNow, setIgnored, Settings, settingsStore } from "./store";

const PLUGIN_ID = "deltacord.messagelogger";
let cleanups: (() => void)[] = [];
let running = false;
export const isLoggerRunning = () => running;

function startLogger() {
    if (running) return;
    running = true;
    // Listen right away so nothing is missed, and merge saved logs in as soon as they're read.
    cleanups.push(interceptMessages());
    cleanups.push(patchRows());
    loadLogs();
}

/**
 * Called at the very start of Deltacord's startup. Core plugins normally start only after
 * plugin repositories are refreshed over the network, which can be after Discord has already
 * opened the last channel, and its deleted messages wouldn't be restored.
 */
export async function startMessageLoggerEarly() {
    try {
        // Safe Mode leaves Deltacord's own plugins off too.
        if (await startingInSafeMode()) return;
        await awaitStorage(pluginSettings);
        if (pluginSettings[PLUGIN_ID]?.enabled === false) return;
        startLogger();
    } catch (e) {
        console.error("[MessageLogger] Early start failed; it will start with the other plugins", e);
    }
}

/** Icon if this Discord build has it, otherwise none (a missing asset shouldn't break the screen). */
function icon(name: string, variant?: string) {
    const id = findAssetId(name);
    return id ? <TableRow.Icon source={id} variant={variant} /> : undefined;
}

const ChannelStore = findByStoreNameLazy("ChannelStore");
const GuildStore = findByStoreNameLazy("GuildStore");
const UserStore = findByStoreNameLazy("UserStore");

function nameOf(list: "ignoredUsers" | "ignoredChannels" | "ignoredGuilds", id: string): string {
    try {
        if (list === "ignoredUsers") {
            const u = UserStore.getUser?.(id);
            return u ? (u.globalName ?? u.username) : `User ${id}`;
        }
        if (list === "ignoredGuilds") return GuildStore.getGuild?.(id)?.name ?? `Server ${id}`;
        const c = ChannelStore.getChannel?.(id);
        return c?.name ? `#${c.name}` : `Channel ${id}`;
    } catch {
        return id;
    }
}

const cycle = <T,>(choices: T[], current: T) => choices[(choices.indexOf(current) + 1) % choices.length];

function SettingsComponent() {
    useProxy(settingsStore);
    const settings = getSettings();
    const [now, setNow] = useState(0);
    const navigation = NavigationNative.useNavigation();

    useEffect(() => {
        const timer = setInterval(() => setNow(n => n + 1), 2000);
        return () => clearInterval(timer);
    }, []);
    void now;
    const totals = counts();

    const toggle = (key: keyof Settings) => (value: boolean) => {
        (settingsStore as any)[key] = value;
        announceSave();
        if (key === "persist" && value) saveNow();
    };
    const switchRow = (key: keyof Settings, label: string, subLabel: string | undefined, iconName: string) => (
        <TableSwitchRow
            label={label}
            subLabel={subLabel}
            icon={icon(iconName)}
            value={settings[key] as boolean}
            onValueChange={toggle(key)}
        />
    );

    const status = !running
        ? "Off"
        : stats.events === 0
            ? "Not receiving messages yet. If this stays, restart Discord."
            : `Working. This session: ${stats.deletesKept} of ${stats.deletesSeen} deletes kept, ${stats.editsLogged} edits logged${stats.ghostPings ? `, ${stats.ghostPings} ghost pings` : ""}.`;
    const ignored = (["ignoredUsers", "ignoredChannels", "ignoredGuilds"] as const)
        .flatMap(list => (settings[list] ?? []).map(id => ({ list, id })));

    return (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 38 }}>
            <Stack style={{ paddingVertical: 24, paddingHorizontal: 12 }} spacing={24}>
                <TableRowGroup title="Status">
                    <TableRow label="Message Logger" subLabel={status} icon={icon(running && stats.events ? "CheckmarkLargeIcon" : "CircleInformationIcon-primary")} />
                    <TableRow
                        label="Marking in chat"
                        subLabel={rowManagerFound()
                            ? `Colours and labels (${rowsStyledCount()} shown this session)`
                            : "Notes under the message text (Discord's chat can't be coloured in this version)"}
                        icon={icon("PaintPaletteIcon")}
                    />
                </TableRowGroup>
                <TableRowGroup>
                    <TableRow
                        arrow
                        label="Browse deleted messages"
                        subLabel={`${totals.deleted} deleted · ${totals.edited} edited · ${totals.ghostPings} ghost pings. Search, jump to them, copy or export.`}
                        icon={icon("MagnifyingGlassIcon")}
                        onPress={() => navigation.push("BUNNY_CUSTOM_PAGE", {
                            title: "Deleted messages",
                            render: () => <LogBrowser />,
                        })}
                    />
                </TableRowGroup>
                <TableRowGroup title="Logging">
                    {switchRow("logDeletes", "Keep deleted messages", "Deleted messages stay in the chat, marked (deleted).", "TrashIcon")}
                    {switchRow("logEdits", "Keep edit history", "Remembers what messages said before they were edited.", "PencilIcon")}
                    {switchRow("ghostPings", "Ghost ping alerts", "Tells you when someone pings you and deletes it, and keeps that message.", "AtIcon")}
                    {switchRow("toastDeletes", "Tell me about deletes", "A small message when something is deleted in the chat you're looking at.", "BellIcon")}
                </TableRowGroup>
                <TableRowGroup title="In the chat">
                    {switchRow("redText", "Red deleted messages", undefined, "PaintPaletteIcon")}
                    {switchRow("showDeleteTime", "Show when it was deleted", "\"deleted 3:04 PM\" instead of \"deleted\".", "ClockIcon")}
                    {switchRow("showEditsInChat", "Show edit history in the chat", "Earlier versions show with the message.", "HistoryIcon")}
                </TableRowGroup>
                <TableRowGroup title="What to log">
                    {switchRow("onlyDMs", "Only DMs", "Skip servers; log direct messages and group chats.", "ChatIcon")}
                    {switchRow("ignoreMuted", "Skip muted channels", undefined, "BellSlashIcon")}
                    {switchRow("ignoreSelf", "Skip my own messages", "When you delete your own message, it really goes away.", "UserIcon")}
                    {switchRow("ignoreBots", "Skip bots", undefined, "RobotIcon")}
                </TableRowGroup>
                <TableRowGroup title={`Ignored (${ignored.length})`}>
                    {ignored.length === 0
                        ? <TableRow label="Nothing ignored" subLabel="In the deleted messages browser, open a message to ignore its person, channel or server." />
                        : ignored.map(({ list, id }) => (
                            <TableRow
                                key={`${list}:${id}`}
                                label={nameOf(list, id)}
                                subLabel={list === "ignoredUsers" ? "Person · tap to stop ignoring" : list === "ignoredGuilds" ? "Server · tap to stop ignoring" : "Channel · tap to stop ignoring"}
                                icon={icon("XSmallIcon")}
                                onPress={() => {
                                    setIgnored(list, id, false);
                                    announceSave();
                                }}
                            />
                        ))}
                </TableRowGroup>
                <TableRowGroup title="Saved logs">
                    {switchRow("persist", "Remember after restart", "Saves logs on your device and shows deleted messages again when you reopen a channel.", "DownloadIcon")}
                    <TableRow
                        label="Keep at most"
                        subLabel="Tap to change. The oldest are forgotten first."
                        icon={icon("ListBulletsIcon")}
                        trailing={<TableRow.TrailingText text={`${settings.maxLogs} messages`} />}
                        onPress={() => {
                            settingsStore.maxLogs = cycle(MAX_LOGS_CHOICES, settings.maxLogs);
                            announceSave();
                        }}
                    />
                    <TableRow
                        label="Forget after"
                        subLabel="Tap to change."
                        icon={icon("ClockIcon")}
                        trailing={<TableRow.TrailingText text={settings.keepDays ? `${settings.keepDays} days` : "Never"} />}
                        onPress={() => {
                            settingsStore.keepDays = cycle(KEEP_DAYS_CHOICES, settings.keepDays);
                            announceSave();
                            saveNow();
                        }}
                    />
                    <TableRow
                        label="Copy everything as text"
                        subLabel="All kept messages, newest first, to paste or save."
                        icon={icon("CopyIcon")}
                        onPress={() => {
                            clipboard.setString(exportLogsText());
                            showToast("Message logs copied", findAssetId("CopyIcon"));
                        }}
                    />
                    <TableRow
                        label="Clear all logs"
                        variant="danger"
                        icon={icon("TrashIcon", "danger")}
                        onPress={() => openAlert(
                            "deltacord-clear-message-logs",
                            <AlertModal
                                title="Clear all logs?"
                                content="Deleted messages disappear from your chats and edit history is forgotten. This can't be undone."
                                actions={<AlertActions>
                                    <AlertActionButton
                                        text="Clear"
                                        variant="destructive"
                                        onPress={() => {
                                            clearAllLogs();
                                            saveNow();
                                            setNow(n => n + 1);
                                            showToast("Message logs cleared", findAssetId("TrashIcon"));
                                        }}
                                    />
                                    <AlertActionButton text="Cancel" variant="secondary" />
                                </AlertActions>}
                            />
                        )}
                    />
                </TableRowGroup>
            </Stack>
        </ScrollView>
    );
}

export default defineCorePlugin({
    manifest: {
        id: PLUGIN_ID,
        name: "Message Logger",
        version: "2.0.0",
        description: "Keeps deleted messages and edit history, catches ghost pings, and lets you search and export it all.",
        authors: [{ name: "Deltacord" }],
    },
    start() {
        startLogger();
    },
    stop() {
        for (const cleanup of cleanups) cleanup();
        cleanups = [];
        running = false;
        if (getSettings().persist) saveNow();
    },
    SettingsComponent,
});
