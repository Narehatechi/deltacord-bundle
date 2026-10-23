/**
 * Crash recovery.
 *
 * - Works out which plugin a crash came from (Bunny plugins run as "bunny-plugin/<id>-<version>",
 *   Vendetta plugins under their URL, and both show up in error stacks).
 * - Crash-loop guard: if Deltacord closes twice in a row within 20 seconds of opening, the next
 *   launch starts in Safe Mode (no plugins, no theme) and says why, so a bad plugin can't lock
 *   you out of Discord.
 * - Fatal JS errors are remembered so the next launch can offer to turn the culprit off.
 */
import { awaitStorage } from "@core/vendetta/storage";
import { VdPluginManager } from "@core/vendetta/plugins";
import { disablePlugin, isPluginEnabled, pluginSettings, registeredPlugins, stopPlugin } from "@lib/addons/plugins";
import { NativeFileModule } from "@lib/api/native/modules";
import { settings } from "@lib/api/settings";
import { awaitStorage as awaitNewStorage } from "@lib/api/storage";

const STATE_FILE = "pyoncord/deltacord-crashguard.json";
const STABLE_AFTER_MS = 20_000;
const UNSTABLE_LIMIT = 2;

export interface Suspect {
    kind: "bunny" | "vendetta";
    id: string;
    name: string;
}

interface GuardState {
    /** Launches in a row that didn't survive STABLE_AFTER_MS. */
    unstable: number;
    lastCrash?: { at: number; message: string; suspect?: Suspect; };
    /** Set when the guard switched Safe Mode on, so we can explain it once. */
    autoSafeMode?: boolean;
}

const docs = () => NativeFileModule.getConstants().DocumentsDirPath;

async function readState(): Promise<GuardState> {
    try {
        const full = `${docs()}/${STATE_FILE}`;
        if (await NativeFileModule.fileExists(full)) return { unstable: 0, ...JSON.parse(await NativeFileModule.readFile(full, "utf8")) };
    } catch { }
    return { unstable: 0 };
}

async function writeState(state: GuardState) {
    try {
        await NativeFileModule.writeFile("documents", STATE_FILE, JSON.stringify(state), "utf8");
    } catch { }
}

/** Every bit of text an error carries: message, stack, component stack, and its causes. */
function errorText(error: any, depth = 0): string {
    if (!error || depth > 4) return "";
    const parts = [error.message, error.stack, error.componentStack].filter(p => typeof p === "string");
    return parts.join("\n") + "\n" + errorText(error.cause, depth + 1);
}

/** Finds the plugin an error came from, if any. */
export function findSuspect(error: unknown): Suspect | undefined {
    const text = errorText(error);
    if (!text) return undefined;

    const bunny = /bunny-plugin\/(.+?)-\d[\w.+-]*/.exec(text);
    if (bunny) {
        const id = bunny[1];
        return { kind: "bunny", id, name: registeredPlugins.get(id)?.name ?? id };
    }

    try {
        for (const [id, plugin] of Object.entries<any>(VdPluginManager.plugins ?? {})) {
            if (id && text.includes(id)) return { kind: "vendetta", id, name: plugin?.manifest?.name ?? id };
        }
    } catch { }
    return undefined;
}

/** Turns the suspect plugin off (and stops it if it's running). */
export function disableSuspect(suspect: Suspect) {
    try {
        if (suspect.kind === "bunny") {
            try {
                stopPlugin(suspect.id);
            } catch { }
            if (isPluginEnabled(suspect.id)) disablePlugin(suspect.id);
            if (pluginSettings[suspect.id]) pluginSettings[suspect.id]!.enabled = false;
        } else {
            VdPluginManager.stopPlugin(suspect.id, true);
        }
    } catch (e) {
        console.error("[CrashGuard] Couldn't turn the plugin off", e);
    }
}

let pendingNotice: GuardState | undefined;
/** The one in-memory copy of the guard state for this launch; every write goes through it. */
let current: GuardState = { unstable: 0 };
let sessionStart = 0;

/**
 * Runs first thing at startup. Returns what happened last time (for the notice shown once
 * Discord is up), after switching Safe Mode on if the app keeps closing right after opening.
 */
export async function initCrashGuard() {
    sessionStart = Date.now();
    const state = current = await readState();
    const previous: GuardState = { ...state };

    state.unstable = (state.unstable ?? 0) + 1;

    if (state.unstable > UNSTABLE_LIMIT) {
        try {
            await awaitStorage(settings);
            if (!settings.safeMode?.enabled) {
                settings.safeMode = { ...settings.safeMode, enabled: true };
                state.autoSafeMode = true;
            }
        } catch { }
        state.unstable = 0;
    }
    await writeState(state);

    // Remember fatal errors (best effort: the app may be gone before this finishes writing).
    try {
        const previousHandler = ErrorUtils.getGlobalHandler();
        ErrorUtils.setGlobalHandler((error: any, isFatal?: boolean) => {
            if (isFatal) {
                current.lastCrash = { at: Date.now(), message: String(error?.message ?? error).slice(0, 500), suspect: findSuspect(error) };
                writeState(current);
            }
            previousHandler?.(error, isFatal);
        });
    } catch { }

    // Survived long enough: this launch counts as stable.
    setTimeout(() => {
        current.unstable = 0;
        writeState(current);
    }, STABLE_AFTER_MS);

    if (state.autoSafeMode || previous.lastCrash) pendingNotice = { ...state, lastCrash: previous.lastCrash };
}

/** Called once Discord is up: explains an automatic Safe Mode or a crash from last time. */
export async function takeCrashNotice(): Promise<GuardState | undefined> {
    await awaitNewStorage(pluginSettings).catch(() => { });
    const notice = pendingNotice;
    pendingNotice = undefined;
    if (notice) {
        // Clear what was reported; keep any crash that happened during this launch.
        if (current.lastCrash && current.lastCrash.at < sessionStart) delete current.lastCrash;
        delete current.autoSafeMode;
        await writeState(current);
    }
    return notice;
}

/** For the Doctor page. */
export async function getCrashGuardState() {
    return readState();
}
