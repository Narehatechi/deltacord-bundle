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
    /** How long the launch stayed alive before Discord was ready (updated every few seconds). */
    aliveMs?: number;
    /** Errors reported during the launch (most recent last). */
    errors?: string[];
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
/** The stuck launch was the one right before this (so it's worth telling you about now). */
let stuckJustNow = false;
export const stuckLastTime = () => stuckJustNow;

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
            let retries = 0;
            try {
                if (await fm.fileExists(path)) retries = Number(JSON.parse(await fm.readFile(path, "utf8"))?.retries ?? 0);
            } catch { }
            stuckLaunch = previous;
            stuckJustNow = true;
            minimal = true;
            await fm.writeFile("documents", MINIMAL_FILE, JSON.stringify({ since: Date.now(), stuckLaunch, retries }), "utf8");
            return;
        }
        const neverReady = !!previous && previous.opened && !previous.uiReady && (previous.aliveMs ?? 0) >= 25_000;
        if (previous && (!previous.opened || neverReady)) {
            // The last launch froze (or sat on Discord's loading screen): remember it and start
            // minimal from now on.
            stuckLaunch = previous;
            stuckJustNow = true;
            minimal = true;
            let retries = 0;
            try {
                if (await fm.fileExists(path)) retries = Number(JSON.parse(await fm.readFile(path, "utf8"))?.retries ?? 0);
            } catch { }
            await fm.writeFile("documents", MINIMAL_FILE, JSON.stringify({ since: Date.now(), stuckLaunch, retries }), "utf8");
            return;
        }
        if (await fm.fileExists(path)) {
            const saved = JSON.parse(await fm.readFile(path, "utf8")) ?? {};
            stuckLaunch = saved.stuckLaunch ?? null;
            const retries = Number(saved.retries ?? 0);
            // The last (minimal) launch opened fine: try the full startup again on its own. If that
            // gets stuck, the stuck flag brings minimal back; after two tries it stays minimal until
            // you choose "Try full startup again".
            if (previous?.minimal && previous.uiReady && retries < 2) {
                minimal = false;
                await fm.writeFile("documents", MINIMAL_FILE, JSON.stringify({ ...saved, retries: retries + 1, retrying: true }), "utf8");
                return;
            }
            if (saved.retrying && previous && !previous.minimal && previous.uiReady) {
                // The retried full startup worked: minimal startup is over.
                await fm.removeFile?.("documents", MINIMAL_FILE);
                return;
            }
            minimal = true;
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
    captureErrors();
    startHeartbeat();
    // Show progress on screen if the last launch never got Discord open (or there's no record yet).
    showOnScreen = !previous?.opened;
    await decideMinimal();
    record.minimal = minimal;
    stage(minimal ? "starting (minimal, the last launch got stuck)" : "starting");
}

// ---------------------------------------------------------------- errors and liveness

function noteError(text: string) {
    if (!record) return;
    const errors = (record.errors ??= []);
    errors.push(text.slice(0, 600));
    if (errors.length > 15) errors.splice(0, errors.length - 15);
    save();
}

function describe(value: any): string {
    if (value instanceof Error) return `${value.name}: ${value.message}\n${String(value.stack ?? "").split("\n").slice(0, 6).join("\n")}`;
    if (typeof value === "string") return value;
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

/** Keeps errors from this launch (console.error and uncaught errors) for the stuck report. */
function captureErrors() {
    try {
        const original = console.error;
        console.error = (...args: any[]) => {
            try {
                if (record && !record.uiReady) noteError(args.map(describe).join(" "));
            } catch { }
            return original.apply(console, args);
        };
    } catch { }
    try {
        const ErrorUtils = (globalThis as any).ErrorUtils;
        const previousHandler = ErrorUtils?.getGlobalHandler?.();
        ErrorUtils?.setGlobalHandler?.((error: any, isFatal?: boolean) => {
            try {
                noteError(`${isFatal ? "FATAL " : ""}${describe(error)}`);
            } catch { }
            previousHandler?.(error, isFatal);
        });
    } catch { }
}

/** Notes every few seconds that the launch is still alive, until Discord is ready. */
function startHeartbeat() {
    const tick = () => {
        if (!record || record.uiReady) return;
        record.aliveMs = Date.now() - record.startedAt;
        save();
        if (record.aliveMs < 120_000) setTimeout(tick, 5000);
    };
    setTimeout(tick, 5000);
}

/** Recorded stages, errors and what the patched app saw, as text to copy and send. */
export async function stuckReportText(): Promise<string> {
    const launch = stuckLaunch;
    const lines: string[] = ["Deltacord stuck-launch report", new Date().toISOString(), ""];
    if (launch) {
        lines.push(`Build ${launch.version}${launch.minimal ? " (minimal)" : ""} · opened: ${launch.opened} · plugins: ${launch.ready} · Discord ready: ${!!launch.uiReady} · alive ${Math.round((launch.aliveMs ?? 0) / 1000)}s`);
        lines.push(`Never finished: ${unfinishedSteps(launch).join(", ") || "nothing recorded"}`);
        lines.push("", "Steps:", ...launch.stages.slice(-30).map(s => `  ${s.name} @${s.ms}ms`));
        if (launch.errors?.length) lines.push("", "Errors:", ...launch.errors.map(e => `  ${e}`));
    } else {
        lines.push("No record of the stuck launch.");
    }
    try {
        const fm = files();
        const path = `${fm.getConstants().DocumentsDirPath}/pyoncord/freeze-report.txt`;
        if (await fm.fileExists(path)) lines.push("", "Patched app's report:", await fm.readFile(path, "utf8"));
    } catch { }
    return lines.join("\n");
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
