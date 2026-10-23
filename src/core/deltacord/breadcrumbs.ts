/**
 * Startup breadcrumbs.
 *
 * Each stage of startup is written to pyoncord/deltacord-startup.json as it happens, so the next
 * launch (and the Doctor page) can tell where a launch that never opened got stuck.
 *
 * If the previous launch never opened, every stage is also shown as a small on-screen message, so
 * a launch that sits on Discord's logo shows how far it got and which Deltacord build is running.
 *
 * Self-contained on purpose: it runs before anything else in Deltacord is set up.
 */

const FILE = "pyoncord/deltacord-startup.json";

export interface StartupRecord {
    version: string;
    startedAt: number;
    /** Reached the point where Deltacord lets Discord open. */
    opened: boolean;
    /** Plugins and Deltacord's after-startup work ran. */
    ready: boolean;
    stages: { name: string; ms: number; }[];
}

function nativeModule(...names: string[]): any {
    for (const name of names) {
        try {
            const viaTurbo = (globalThis as any).__turboModuleProxy?.(name);
            if (viaTurbo) return viaTurbo;
            const viaBridge = (globalThis as any).nativeModuleProxy?.[name];
            if (viaBridge) return viaBridge;
        } catch { }
    }
    return undefined;
}

const files = () => nativeModule("NativeFileModule", "RTNFileManager", "DCDFileManager");

let record: StartupRecord | undefined;
let previous: StartupRecord | null = null;
let showOnScreen = false;
let writing: Promise<void> = Promise.resolve();

function toast(message: string) {
    if (!showOnScreen) return;
    try {
        const toasts = nativeModule("ToastAndroid");
        toasts?.show?.(message, 1);
    } catch { }
}

function save() {
    const snapshot = JSON.stringify(record);
    writing = writing.then(async () => {
        try {
            await files()?.writeFile?.("documents", FILE, snapshot, "utf8");
        } catch { }
    });
}

/** First thing at startup. */
export async function beginStartup(version: string) {
    record = { version, startedAt: Date.now(), opened: false, ready: false, stages: [] };
    try {
        const fm = files();
        const path = `${fm.getConstants().DocumentsDirPath}/${FILE}`;
        if (await fm.fileExists(path)) previous = JSON.parse(await fm.readFile(path, "utf8"));
    } catch {
        previous = null;
    }
    // Show progress on screen if the last launch never got Discord open (or there's no record yet).
    showOnScreen = !previous?.opened;
    stage("starting");
}

/** Records a stage. `quiet` ones go to the file only, not on screen. */
export function stage(name: string, { quiet = false } = {}) {
    if (!record) return;
    record.stages.push({ name, ms: Date.now() - record.startedAt });
    save();
    if (!quiet) toast(`Deltacord ${record.version}: ${name}`);
}

export function markOpened() {
    if (!record) return;
    record.opened = true;
    stage("opening Discord");
}

export function markReady() {
    if (!record) return;
    record.ready = true;
    stage("ready");
}

/** The launch before this one (for the Doctor page). */
export const previousStartup = () => previous;
export const currentStartup = () => record;
