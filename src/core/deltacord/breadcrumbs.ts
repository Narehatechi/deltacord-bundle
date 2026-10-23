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
    /** Discord's real screen is up (connected, or showing the login screen). */
    uiReady?: boolean;
    /** Started without Deltacord's own additions. */
    minimal?: boolean;
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

function toast(message: string) {
    if (!showOnScreen) return;
    try {
        const toasts = nativeModule("ToastAndroid");
        toasts?.show?.(message, 1);
    } catch { }
}

function save() {
    // Called straight away (not queued behind a promise), so the stage reaches the file even if
    // what comes next freezes Discord.
    try {
        files()?.writeFile?.("documents", FILE, JSON.stringify(record), "utf8")?.catch?.(() => { });
    } catch { }
}

// ---------------------------------------------------------------- minimal startup

const MINIMAL_FILE = "pyoncord/deltacord-minimal.json";
let minimal = false;
let stuckLaunch: StartupRecord | null = null;

/**
 * Minimal startup: after a launch that never got Discord open, Deltacord starts without its own
 * additions (theme setup, Message Logger, Tweaks, extras) until you choose to try the full startup
 * again. Discord opens, and the stuck launch is kept so the Doctor page can show where it froze.
 */
export const isMinimalStartup = () => minimal;
export const getStuckLaunch = () => stuckLaunch;

/** Steps the stuck launch started but never finished. */
export function unfinishedSteps(launch: StartupRecord | null = stuckLaunch): string[] {
    if (!launch) return [];
    const started = new Set<string>();
    for (const { name } of launch.stages) {
        if (name.startsWith("start: ")) started.add(name.slice(7));
        else if (name.startsWith("done: ")) started.delete(name.slice(6));
    }
    return [...started];
}

export async function leaveMinimalStartup() {
    try {
        await files()?.removeFile?.("documents", MINIMAL_FILE);
    } catch { }
    minimal = false;
}

/** Written by the patched app when it sees a launch get stuck after Deltacord opened Discord. */
const STUCK_FLAG = "pyoncord/last-launch-stuck";

async function decideMinimal() {
    const fm = files();
    const path = `${fm.getConstants().DocumentsDirPath}/${MINIMAL_FILE}`;
    try {
        // The patched app saw the last launch get stuck (even after Deltacord had finished).
        const flagPath = `${fm.getConstants().DocumentsDirPath}/${STUCK_FLAG}`;
        if (await fm.fileExists(flagPath)) {
            try {
                await fm.removeFile?.("documents", STUCK_FLAG);
            } catch { }
            stuckLaunch = previous;
            minimal = true;
            await fm.writeFile("documents", MINIMAL_FILE, JSON.stringify({ since: Date.now(), stuckLaunch }), "utf8");
            return;
        }
        if (previous && !previous.opened) {
            // The last launch froze: remember it and start minimal from now on.
            stuckLaunch = previous;
            minimal = true;
            await fm.writeFile("documents", MINIMAL_FILE, JSON.stringify({ since: Date.now(), stuckLaunch }), "utf8");
            return;
        }
        if (await fm.fileExists(path)) {
            minimal = true;
            stuckLaunch = JSON.parse(await fm.readFile(path, "utf8"))?.stuckLaunch ?? null;
        }
    } catch {
        // Can't tell: keep it simple and start minimal only if the last launch froze.
        minimal = !!previous && !previous.opened;
    }
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
    await decideMinimal();
    record.minimal = minimal;
    stage(minimal ? "starting (minimal, the last launch got stuck)" : "starting");
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

/** Discord's real screen is up. The startup animation waits for this before it fades. */
export function markUiReady(how: string) {
    if (!record || record.uiReady) return;
    record.uiReady = true;
    stage(`Discord ready (${how})`, { quiet: true });
}

export function markReady() {
    if (!record) return;
    record.ready = true;
    stage("ready");
}

/** The launch before this one (for the Doctor page). */
export const previousStartup = () => previous;
export const currentStartup = () => record;
