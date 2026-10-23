import { useProxy } from "@core/vendetta/storage";
import { pluginSettings } from "@lib/addons/plugins";
import { awaitStorage } from "@lib/api/storage";
import { findAssetId } from "@lib/api/assets";
import { openAlert } from "@lib/ui/alerts";
import { showToast } from "@lib/ui/toasts";
import { NavigationNative } from "@metro/common";
import { AlertActionButton, AlertActions, AlertModal, Stack, TableRow, TableRowGroup, TableSwitchRow } from "@metro/common/components";
import { useEffect, useState } from "react";
import { ScrollView } from "react-native";

import { announceSave } from "@core/deltacord/extras";

import { defineCorePlugin } from "..";
import LogBrowser from "./browser";
import { clearAllLogs, interceptMessages } from "./logger";
import { patchRows } from "./rows";
import { counts, getSettings, loadLogs, saveNow, Settings, settingsStore } from "./store";

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

function SettingsComponent() {
    useProxy(settingsStore);
    const settings = getSettings();
    const [stats, setStats] = useState(counts());
    const navigation = NavigationNative.useNavigation();

    useEffect(() => {
        const timer = setInterval(() => setStats(counts()), 2000);
        return () => clearInterval(timer);
    }, []);

    const toggle = (key: keyof Settings) => (value: boolean) => {
        settingsStore[key] = value;
        announceSave();
        if (key === "persist" && value) saveNow();
    };

    return (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 38 }}>
            <Stack style={{ paddingVertical: 24, paddingHorizontal: 12 }} spacing={24}>
                <TableRowGroup>
                    <TableRow
                        arrow
                        label="Browse deleted messages"
                        subLabel={`${stats.deleted} deleted · ${stats.edited} edited. Search, jump to them, or copy them.`}
                        icon={icon("MagnifyingGlassIcon")}
                        onPress={() => navigation.push("BUNNY_CUSTOM_PAGE", {
                            title: "Deleted messages",
                            render: () => <LogBrowser />,
                        })}
                    />
                </TableRowGroup>
                <TableRowGroup title="Logging">
                    <TableSwitchRow
                        label="Keep deleted messages"
                        subLabel="Deleted messages stay in the chat in red, marked (deleted)."
                        icon={icon("TrashIcon")}
                        value={settings.logDeletes}
                        onValueChange={toggle("logDeletes")}
                    />
                    <TableSwitchRow
                        label="Keep edit history"
                        subLabel="Earlier versions show above the current text."
                        icon={icon("PencilIcon")}
                        value={settings.logEdits}
                        onValueChange={toggle("logEdits")}
                    />
                    <TableSwitchRow
                        label="Remember after restart"
                        subLabel="Saves logs on your device and shows deleted messages again when you reopen a channel."
                        icon={icon("DownloadIcon")}
                        value={settings.persist}
                        onValueChange={toggle("persist")}
                    />
                </TableRowGroup>
                <TableRowGroup title="Ignore">
                    <TableSwitchRow
                        label="My own messages"
                        subLabel="When you delete your own message, it really goes away."
                        icon={icon("UserIcon")}
                        value={settings.ignoreSelf}
                        onValueChange={toggle("ignoreSelf")}
                    />
                    <TableSwitchRow
                        label="Bots"
                        icon={icon("RobotIcon")}
                        value={settings.ignoreBots}
                        onValueChange={toggle("ignoreBots")}
                    />
                </TableRowGroup>
                <TableRowGroup title="Saved logs">
                    <TableRow
                        label="Deleted messages kept"
                        trailing={<TableRow.TrailingText text={String(stats.deleted)} />}
                    />
                    <TableRow
                        label="Messages with edit history"
                        trailing={<TableRow.TrailingText text={String(stats.edited)} />}
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
                                            setStats(counts());
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
        version: "1.0.0",
        description: "Keeps deleted messages and edit history, even after you restart the app.",
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
