/**
 * Persistent storage for the message logger.
 *
 * Logs live in memory for fast lookups while rendering, and are written to
 * `pyoncord/deltacord-message-logs.json` (debounced) so they survive restarts.
 * Deleted messages keep a copy of the raw message, which is what lets them be
 * slipped back into the chat after Discord forgets them.
 */
import { createMMKVBackend, createStorage, wrapSync } from "@core/vendetta/storage";
import { fileExists, readFile, writeFile } from "@lib/api/native/fs";

const LOG_FILE = "deltacord-message-logs.json";
const FILE_VERSION = 1;

/** Oldest logs are dropped past this, so the file can't grow forever. */
export const MAX_LOGS = 5000;
/** Edit history kept per message. */
export const MAX_EDITS = 25;

export interface Settings {
    logDeletes: boolean;
    logEdits: boolean;
    /** Keep logs across restarts, and show deleted messages again when a channel loads. */
    persist: boolean;
    ignoreSelf: boolean;
    ignoreBots: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
    logDeletes: true,
    logEdits: true,
    persist: true,
    ignoreSelf: true,
    ignoreBots: false,
};

export const settingsStore = wrapSync(createStorage<Partial<Settings>>(createMMKVBackend("DELTACORD_MESSAGE_LOGGER")));

export function getSettings(): Settings {
    return { ...DEFAULT_SETTINGS, ...(settingsStore ?? {}) } as Settings;
}

export interface Edit {
    /** The text before this edit replaced it. */
    content: string;
    at: number;
}

export interface Log {
    channelId: string;
    guildId?: string;
    deleted: boolean;
    deletedAt?: number;
    /** Raw (API-shaped) copy of the message, kept for deleted messages. */
    raw?: any;
    /** Previous versions, oldest first. */
    edits: Edit[];
    /** Last time this log changed, used for pruning. */
    touched: number;
    /** Who wrote it, for the browser (deleted messages also have it in raw). */
    author?: { id?: string; name?: string; };
    /** Latest known text, for edited messages that weren't deleted. */
    current?: string;
}

interface LogFile {
    version: number;
    logs: Record<string, Log>;
}

export const logs = new Map<string, Log>();
let loaded = false;
let loading = false;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

/** Merges saved logs in; anything logged since startup wins over the saved copy. */
export async function loadLogs() {
    loaded = false;
    loading = true;

    try {
        if (await fileExists(LOG_FILE)) {
            const file = JSON.parse(await readFile(LOG_FILE)) as LogFile;
            if (file?.version === FILE_VERSION && file.logs) {
                for (const [id, log] of Object.entries(file.logs)) {
                    if (!logs.has(id)) logs.set(id, log);
                }
            }
        }
    } catch (e) {
        console.error("[MessageLogger] Couldn't read saved logs, starting fresh", e);
        // Keep the damaged file so the next save doesn't destroy what might still be recovered.
        try {
            await writeFile(`${LOG_FILE}.damaged`, await readFile(LOG_FILE));
        } catch { }
    }

    loading = false;
    loaded = true;
}

export const isLoaded = () => loaded;

function prune() {
    if (logs.size <= MAX_LOGS) return;
    const oldest = [...logs.entries()].sort(([, a], [, b]) => a.touched - b.touched);
    for (const [id] of oldest.slice(0, logs.size - MAX_LOGS)) logs.delete(id);
}

/** Saves soon, batching bursts of deletes/edits into one write. */
export function scheduleSave() {
    if (!getSettings().persist) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 1000);
}

export async function saveNow() {
    saveTimer = undefined;
    // Saving before the saved logs are read back would overwrite them with only this launch's.
    if (!loaded) {
        if (loading) saveTimer = setTimeout(saveNow, 1000);
        return;
    }
    prune();
    const file: LogFile = { version: FILE_VERSION, logs: Object.fromEntries(logs) };
    try {
        await writeFile(LOG_FILE, JSON.stringify(file));
    } catch (e) {
        console.error("[MessageLogger] Couldn't save logs", e);
    }
}

export function logFor(id: string, channelId: string, guildId?: string): Log {
    let log = logs.get(id);
    if (!log) {
        log = { channelId, guildId, deleted: false, edits: [], touched: Date.now() };
        logs.set(id, log);
    }
    return log;
}

export function counts() {
    let deleted = 0, edited = 0;
    for (const log of logs.values()) {
        if (log.deleted) deleted++;
        if (log.edits.length) edited++;
    }
    return { deleted, edited, total: logs.size };
}
