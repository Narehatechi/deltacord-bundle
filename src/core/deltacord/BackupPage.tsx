import { findAssetId } from "@lib/api/assets";
import { openAlert } from "@lib/ui/alerts";
import { showToast } from "@lib/ui/toasts";
import { clipboard } from "@metro/common";
import { AlertActionButton, AlertActions, AlertModal, Stack, TableRow, TableRowGroup, TableSwitchRow, Text } from "@metro/common/components";
import { useEffect, useState } from "react";
import { ScrollView, Share } from "react-native";

import {
    Backup,
    backupSize,
    createBackup,
    listLocalBackups,
    LocalBackupInfo,
    parseBackup,
    readLocalBackup,
    restoreBackup,
    saveLocalBackup,
    SHARE_LIMIT,
} from "./backup";

const icon = (name: string) => {
    const id = findAssetId(name);
    return id ? <TableRow.Icon source={id} /> : undefined;
};

const kb = (n: number) => n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
const when = (ms: number) => new Date(ms).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

function confirmRestore(backup: Backup) {
    const count = Object.keys(backup.files).length;
    openAlert(
        "deltacord-confirm-restore",
        <AlertModal
            title="Restore this backup?"
            content={`From ${when(backup.createdAt)}. Your current plugins, themes, fonts and settings${backup.includesLogs ? " and message logs" : ""} are replaced (${count} files), then Discord restarts.`}
            actions={<AlertActions>
                <AlertActionButton
                    text="Restore and restart"
                    variant="destructive"
                    onPress={() => restoreBackup(backup).catch(e => showToast(`Restore failed: ${e?.message ?? e}`))}
                />
                <AlertActionButton text="Cancel" variant="secondary" />
            </AlertActions>}
        />
    );
}

export default function BackupPage() {
    const [includeLogs, setIncludeLogs] = useState(true);
    const [local, setLocal] = useState<LocalBackupInfo[]>([]);
    const [busy, setBusy] = useState(false);

    const refresh = () => listLocalBackups().then(setLocal).catch(() => setLocal([]));
    useEffect(() => void refresh(), []);

    const withBackup = async (fn: (b: Backup, size: number) => Promise<void> | void) => {
        if (busy) return;
        setBusy(true);
        try {
            const backup = await createBackup({ includeLogs });
            await fn(backup, backupSize(backup));
        } catch (e: any) {
            showToast(`Backup failed: ${e?.message ?? e}`);
        } finally {
            setBusy(false);
        }
    };

    const tooBig = (size: number) => {
        if (size <= SHARE_LIMIT) return false;
        openAlert(
            "deltacord-backup-too-big",
            <AlertModal
                title="Too big to share"
                content={`This backup is ${kb(size)}, more than Android lets apps share at once. Turn off "Include message logs" to make it smaller, or save it on this phone instead.`}
                actions={<AlertActions><AlertActionButton text="OK" variant="primary" /></AlertActions>}
            />
        );
        return true;
    };

    return (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 38 }}>
            <Stack style={{ paddingVertical: 24, paddingHorizontal: 12 }} spacing={24}>
                <Text variant="text-sm/medium" color="text-muted">
                    A backup holds your plugins (and their settings), themes, fonts, Deltacord settings and, if you like, your message logs.
                </Text>

                <TableRowGroup title="Make a backup">
                    <TableSwitchRow
                        label="Include message logs"
                        subLabel="Deleted messages and edit history. Can make the backup much bigger."
                        icon={icon("ChatIcon")}
                        value={includeLogs}
                        onValueChange={setIncludeLogs}
                    />
                    <TableRow
                        label="Save on this phone"
                        subLabel="Kept in Deltacord's folder; the 5 newest are kept."
                        icon={icon("DownloadIcon")}
                        disabled={busy}
                        onPress={() => withBackup(async (backup, size) => {
                            await saveLocalBackup(backup);
                            await refresh();
                            showToast(`Backup saved (${kb(size)})`, findAssetId("CheckmarkLargeIcon"));
                        })}
                    />
                    <TableRow
                        label="Share backup"
                        subLabel="Send it to Drive, Notes or a chat to move Deltacord to another phone."
                        icon={icon("ShareIcon")}
                        disabled={busy}
                        onPress={() => withBackup(async (backup, size) => {
                            if (tooBig(size)) return;
                            await Share.share({ title: "Deltacord backup", message: JSON.stringify(backup) });
                        })}
                    />
                    <TableRow
                        label="Copy backup"
                        icon={icon("CopyIcon")}
                        disabled={busy}
                        onPress={() => withBackup((backup, size) => {
                            if (tooBig(size)) return;
                            clipboard.setString(JSON.stringify(backup));
                            showToast(`Backup copied (${kb(size)})`, findAssetId("CopyIcon"));
                        })}
                    />
                </TableRowGroup>

                <TableRowGroup title="Restore">
                    <TableRow
                        label="Restore from copied text"
                        subLabel="Copy a shared backup's text first, then tap here."
                        icon={icon("ClipboardListIcon") ?? icon("CopyIcon")}
                        onPress={async () => {
                            try {
                                confirmRestore(parseBackup(await clipboard.getString()));
                            } catch (e: any) {
                                showToast(e?.message ?? String(e));
                            }
                        }}
                    />
                    {local.length === 0
                        ? <TableRow label="No backups on this phone yet" />
                        : local.map(info => (
                            <TableRow
                                key={info.file}
                                arrow
                                label={when(info.createdAt)}
                                subLabel={`${kb(info.size)}${info.includesLogs ? " · with message logs" : ""}`}
                                icon={icon("ClockIcon")}
                                onPress={async () => {
                                    try {
                                        confirmRestore(await readLocalBackup(info));
                                    } catch (e: any) {
                                        showToast(e?.message ?? String(e));
                                    }
                                }}
                            />
                        ))}
                </TableRowGroup>
            </Stack>
        </ScrollView>
    );
}
