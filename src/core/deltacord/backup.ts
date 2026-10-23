/**
 * Backup & restore for Deltacord.
 *
 * Everything Deltacord keeps (settings, themes, fonts, plugin lists, each plugin's own data,
 * message logs) is a plain file in Discord's documents folder, so a backup is a JSON bundle
 * of those files. Restoring writes them back and reloads Discord straight away, before any
 * in-memory copy can overwrite them.
 */
import { getThemeFilePath } from "@lib/api/native/loader";
import { BundleUpdaterManager, NativeFileModule } from "@lib/api/native/modules";

export const BACKUP_FORMAT = "deltacord-backup";
const BACKUP_VERSION = 1;
import { backupPaths as profileBackupPaths } from "./profiles/storage";

const BACKUP_DIR = "pyoncord/backups";
const INDEX_FILE = `${BACKUP_DIR}/index.json`;
const KEEP_LOCAL = 5;
export const LOGS_FILE = "pyoncord/deltacord-message-logs.json";
/** Android rejects larger share/clipboard payloads, so bigger backups are only saved on the phone. */
export const SHARE_LIMIT = 400_000;

/** Stores kept in the documents folder under vd_mmkv/. */
const CORE_STORES = [
    "VENDETTA_SETTINGS",
    "VENDETTA_THEMES",
    "VENDETTA_PLUGINS",
    "BUNNY_FONTS",
    "DELTACORD_BUILTIN_THEMES",
    "DELTACORD_MESSAGE_LOGGER",
    "DELTACORD_TWEAKS",
    "DELTACORD_EXTRAS",
];

const CORE_FILES = [
    "pyoncord/plugins/repositories.json",
    "pyoncord/plugins/settings.json",
    "pyoncord/themes/colors/preferences.json",
];

export interface Backup {
    format: typeof BACKUP_FORMAT;
    version: number;
    createdAt: number;
    includesLogs: boolean;
    files: Record<string, string>;
}

export interface LocalBackupInfo {
    file: string;
    createdAt: number;
    size: number;
    includesLogs: boolean;
}

const docs = () => NativeFileModule.getConstants().DocumentsDirPath;

/** Same file naming the storage layer uses for its stores. */
export const storePath = (name: string) => `vd_mmkv/${name.replace(/[<>:"/\\|?*]/g, "-").replace(/-+/g, "-")}`;

async function readDoc(path: string): Promise<string | null> {
    const full = `${docs()}/${path}`;
    try {
        if (!await NativeFileModule.fileExists(full)) return null;
        return await NativeFileModule.readFile(full, "utf8");
    } catch {
        return null;
    }
}

async function writeDoc(path: string, content: string) {
    await NativeFileModule.writeFile("documents", path, content, "utf8");
}

function keysOf(json: string | null): string[] {
    if (!json) return [];
    try {
        const parsed = JSON.parse(json);
        return parsed && typeof parsed === "object" ? Object.keys(parsed) : [];
    } catch {
        return [];
    }
}

/** Collects every file worth backing up. */
export async function createBackup({ includeLogs }: { includeLogs: boolean; }): Promise<Backup> {
    const paths = new Set<string>([...CORE_STORES.map(storePath), ...CORE_FILES]);

    const themeFile = getThemeFilePath();
    if (themeFile) paths.add(themeFile);

    // Each Bunny-style plugin's own data.
    for (const id of keysOf(await readDoc("pyoncord/plugins/settings.json"))) {
        paths.add(`pyoncord/plugins/storage/${id}.json`);
    }
    // Each Vendetta-style plugin's own data (stored under its URL).
    for (const id of keysOf(await readDoc(storePath("VENDETTA_PLUGINS")))) {
        paths.add(storePath(id));
    }
    if (includeLogs) paths.add(LOGS_FILE);
    // Saved profiles and their avatar images.
    try {
        for (const path of await profileBackupPaths()) paths.add(path);
    } catch { }

    const files: Record<string, string> = {};
    for (const path of paths) {
        const content = await readDoc(path);
        if (content != null) files[path] = content;
    }

    return { format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: Date.now(), includesLogs: includeLogs, files };
}

export function parseBackup(text: string): Backup {
    let data: any;
    try {
        data = JSON.parse(text.trim());
    } catch {
        throw new Error("That isn't a Deltacord backup (it's not valid JSON).");
    }
    if (data?.format !== BACKUP_FORMAT || typeof data.files !== "object") {
        throw new Error("That isn't a Deltacord backup.");
    }
    if (data.version > BACKUP_VERSION) {
        throw new Error("This backup was made by a newer Deltacord. Update Deltacord first.");
    }
    for (const [path, content] of Object.entries(data.files)) {
        // Only ever write inside the folders Deltacord owns.
        if (typeof content !== "string" || path.includes("..") || !/^(vd_mmkv\/|pyoncord\/|vendetta_theme\.json$)/.test(path)) {
            throw new Error(`The backup contains an unexpected file (${path}).`);
        }
    }
    return data as Backup;
}

/** Writes a backup's files back and reloads Discord. */
export async function restoreBackup(backup: Backup) {
    for (const [path, content] of Object.entries(backup.files)) {
        await writeDoc(path, content);
    }
    BundleUpdaterManager.reload();
}

export const backupSize = (backup: Backup) => JSON.stringify(backup).length;

// ------------------------------------------------------------ local backups

async function readIndex(): Promise<LocalBackupInfo[]> {
    try {
        const list = JSON.parse((await readDoc(INDEX_FILE)) ?? "[]");
        return Array.isArray(list) ? list : [];
    } catch {
        return [];
    }
}

export async function listLocalBackups(): Promise<LocalBackupInfo[]> {
    return (await readIndex()).sort((a, b) => b.createdAt - a.createdAt);
}

/** Saves a backup on the phone, keeping the newest few. */
export async function saveLocalBackup(backup: Backup): Promise<LocalBackupInfo> {
    const text = JSON.stringify(backup);
    const file = `${BACKUP_DIR}/backup-${backup.createdAt}.json`;
    await writeDoc(file, text);

    const info: LocalBackupInfo = { file, createdAt: backup.createdAt, size: text.length, includesLogs: backup.includesLogs };
    const list = [info, ...(await readIndex()).filter(b => b.file !== file)].sort((a, b) => b.createdAt - a.createdAt);
    for (const old of list.slice(KEEP_LOCAL)) {
        try {
            await NativeFileModule.removeFile?.("documents", old.file);
        } catch { }
    }
    await writeDoc(INDEX_FILE, JSON.stringify(list.slice(0, KEEP_LOCAL)));
    return info;
}

export async function readLocalBackup(info: LocalBackupInfo): Promise<Backup> {
    const text = await readDoc(info.file);
    if (!text) throw new Error("That backup file is missing.");
    return parseBackup(text);
}

/** A quiet safety net: one automatic local backup every few days. */
export async function autoBackupIfDue(maxAgeDays = 3) {
    try {
        const newest = (await listLocalBackups())[0];
        if (newest && Date.now() - newest.createdAt < maxAgeDays * 86_400_000) return;
        await saveLocalBackup(await createBackup({ includeLogs: true }));
    } catch (e) {
        console.error("[Deltacord] Automatic backup failed", e);
    }
}
