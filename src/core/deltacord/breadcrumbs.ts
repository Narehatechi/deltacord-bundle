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

// ---------------------------------------------------------------- self-healing features
//
// Deltacord's features are in groups. Normally all are on. If a launch gets stuck, Deltacord finds
// the group responsible on its own, without you doing anything: the next launch starts with the
// groups off (so Discord opens), then each launch that opens fine switches one more group back on.
// If switching one on gets Discord stuck, that group stays off and the rest come back. A new
// Deltacord build gives every group another chance (that's how a fix reaches you).

/** In the order they're switched back on: least likely to cause trouble first. */
export const FEATURES = ["extras", "crashguard", "fontsync", "logger", "plugins", "tweaks", "theme"] as const;
export type Feature = typeof FEATURES[number];

export const FEATURE_NAMES: Record<Feature, string> = {
    extras: "Extras (blips, save sounds)",
    crashguard: "Crash guard",
    fontsync: "Theme font",
    logger: "Message Logger",
    plugins: "Your plugins",
    tweaks: "Tweaks",
    theme: "Theme",
};

interface FeatureState {
    /** Finding the culprit: only `on` (plus `trying`) are on. */
    probing: boolean;
    on: Feature[];
    trying: Feature | null;
    /** Groups found to get Discord stuck (stay off until a new build). */
    culprits: Feature[];
    /** Build the culprits were found with. */
    version?: string;
    stuckLaunch?: StartupRecord | null;
}

const FEATURES_FILE = "pyoncord/deltacord-features.json";
const OLD_MINIMAL_FILE = "pyoncord/deltacord-minimal.json";
/** Written by the patched app when it sees a launch get stuck. */
const STUCK_FLAG = "pyoncord/last-launch-stuck";

let state: FeatureState = { probing: false, on: [], trying: null, culprits: [] };
let stuckLaunch: StartupRecord | null = null;
let stuckJustNow = false;
let foundJustNow: Feature | null = null;

export const stuckLastTime = () => stuckJustNow;
/** A group that was just found to get Discord stuck (this launch is the first without it). */
export const culpritFoundNow = () => foundJustNow;
export const getStuckLaunch = () => stuckLaunch;
export const featureState = () => state;

/** Whether a feature group runs this launch. */
export function isFeatureOn(feature: Feature): boolean {
    if (state.probing) return state.on.includes(feature) || state.trying === feature;
    return !state.culprits.includes(feature);
}

/** Some groups are off this launch (finding a culprit, or one was found). */
export const isMinimalStartup = () => FEATURES.some(f => !isFeatureOn(f));

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

/** Turn everything back on now (next launch). */
export async function leaveMinimalStartup() {
    state = { probing: false, on: [], trying: null, culprits: [] };
    await saveState();
}

async function saveState() {
    try {
        await files()?.writeFile?.("documents", FEATURES_FILE, JSON.stringify(state), "utf8");
    } catch { }
}

/** Decides which groups run this launch, from how the last launch went. */
export function nextFeatureState(
    current: FeatureState,
    last: StartupRecord | null,
    stuckFlag: boolean,
    version: string,
): { state: FeatureState; stuck: boolean; found: Feature | null; } {
    const next: FeatureState = { ...current, on: [...current.on], culprits: [...current.culprits] };
    let found: Feature | null = null;

    // A new build gives every group another chance.
    if (next.version && next.version !== version) {
        next.culprits = [];
        next.version = undefined;
        if (!next.probing) next.on = [];
    }

    const neverReady = !!last && last.opened && !last.uiReady && (last.aliveMs ?? 0) >= 25_000;
    const stuck = stuckFlag || (!!last && !last.opened) || neverReady;
    const ok = !!last && last.uiReady === true;

    if (stuck) {
        next.stuckLaunch = last;
        if (next.probing && next.trying) {
            // Switching this group on got Discord stuck: it's the culprit.
            found = next.trying;
            if (!next.culprits.includes(found)) next.culprits.push(found);
            next.version = version;
            next.trying = null;
        } else if (!next.probing) {
            // Start finding the culprit: everything off (but known culprits) this launch.
            next.probing = true;
            next.on = [];
            next.trying = null;
        }
        // (Stuck with every group off: it isn't one of them; stay like this, the report says more.)
    } else if (ok && next.probing) {
        if (next.trying) {
            if (!next.on.includes(next.trying)) next.on.push(next.trying);
            next.trying = null;
        }
        const candidate = FEATURES.find(f => !next.on.includes(f) && !next.culprits.includes(f));
        if (candidate) next.trying = candidate;
        else {
            // Every group checked: back to normal, minus any culprit.
            next.probing = false;
            next.on = [];
        }
    }
    // Otherwise (closed before Discord was ready, or offline): same as last time.

    return { state: next, stuck, found };
}

async function decideFeatures(version: string) {
    const fm = files();
    const docs = fm.getConstants().DocumentsDirPath;
    try {
        if (await fm.fileExists(`${docs}/${FEATURES_FILE}`)) {
            state = { ...state, ...JSON.parse(await fm.readFile(`${docs}/${FEATURES_FILE}`, "utf8")) };
        }
    } catch { }

    let stuckFlag = false;
    try {
        if (await fm.fileExists(`${docs}/${STUCK_FLAG}`)) {
            stuckFlag = true;
            await fm.removeFile?.("documents", STUCK_FLAG);
        }
        // The old all-or-nothing "minimal startup" is replaced by this.
        if (await fm.fileExists(`${docs}/${OLD_MINIMAL_FILE}`)) await fm.removeFile?.("documents", OLD_MINIMAL_FILE);
    } catch { }

    // Everything is always on. A stuck launch is still noticed (so its report can be copied), but
    // no feature is switched off because of it, and any left off by older builds comes back on.
    const result = nextFeatureState(state, previous, stuckFlag, version);
    stuckJustNow = result.stuck;
    foundJustNow = null;
    stuckLaunch = result.stuck ? previous : null;
    state = { probing: false, on: [], trying: null, culprits: [] };
    await saveState();
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
    await decideFeatures(version);
    record.minimal = isMinimalStartup();
    const off = FEATURES.filter(f => !isFeatureOn(f));
    stage(off.length ? `starting (off: ${off.join(", ")})` : "starting");
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
