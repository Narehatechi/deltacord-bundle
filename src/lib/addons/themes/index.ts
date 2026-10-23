import { awaitStorage, createFileBackend, createMMKVBackend, createStorage, wrapSync } from "@core/vendetta/storage";
import { writeFile } from "@lib/api/native/fs";
import { getStoredTheme, getThemeFilePath, isPyonLoader, isThemeSupported } from "@lib/api/native/loader";
import { awaitStorage as newAwaitStorage } from "@lib/api/storage";
import { safeFetch } from "@lib/utils";
import { Platform } from "react-native";

import { announceSave, isUserTime } from "@core/deltacord/extras";
import { onThemeChosen } from "@core/deltacord/themeFont";
import { startingInSafeMode } from "@core/deltacord/safeModeGate";
import { isMinimalStartup } from "@core/deltacord/breadcrumbs";
import { settings } from "@lib/api/settings";

import initColors from "./colors";
import { applyAndroidAlphaKeys, normalizeToHex } from "./colors/parser";
import { colorsPref } from "./colors/preferences";
import { VendettaThemeManifest } from "./colors/types";
import { BUILTIN_THEME_IDS, buildBuiltinTheme, DELTARUNE_THEME_ID } from "./builtin/deltarune";

const BUILTIN_PREFIX = "deltacord://builtin/";

/** Remembers which built-in themes were already installed, so a removed one stays removed. */
const builtinFlags = wrapSync(createStorage<{ installed?: Record<string, boolean>; }>(createMMKVBackend("DELTACORD_BUILTIN_THEMES")));

function getBuiltinTheme(id: string) {
    return buildBuiltinTheme(id);
}
import { updateBunnyColor } from "./colors/updater";

export interface VdThemeInfo {
    id: string;
    selected: boolean;
    data: VendettaThemeManifest;
}

export const themes = wrapSync(createStorage<Record<string, VdThemeInfo>>(createMMKVBackend("VENDETTA_THEMES")));

/**
 * @internal
 */
export async function writeThemeToNative(theme: VdThemeInfo | {}) {
    if (typeof theme !== "object") throw new Error("Theme must be an object");

    // Save the current theme as current-theme.json. When supported by loader,
    // this json will be written to appropriate path and be used to theme the native side.
    await createFileBackend(getThemeFilePath() || "theme.json").set(theme);
}

// Process data for some compatiblity with native side
function processData(data: VendettaThemeManifest) {
    if (data.semanticColors) {
        const { semanticColors } = data;

        for (const key in semanticColors) {
            for (const index in semanticColors[key]) {
                semanticColors[key][index] &&= normalizeToHex(semanticColors[key][index] as string) || false;
            }
        }
    }

    if (data.rawColors) {
        const { rawColors } = data;

        for (const key in rawColors) {
            const normalized = normalizeToHex(rawColors[key]);
            if (normalized) data.rawColors[key] = normalized;
        }

        if (Platform.OS === "android") applyAndroidAlphaKeys(rawColors);
    }

    // this field is required by the spec but vd seems to ignore this
    // so are most vd themes
    data.spec ??= 2;

    return data;
}

function validateTheme(themeJSON: any): boolean {
    if (typeof themeJSON !== "object" || themeJSON === null) return false;
    if (themeJSON.spec !== 2 && themeJSON.spec !== 3) return false;
    if (themeJSON.spec === 3 && !themeJSON.main) return false;

    return true;
}

export async function fetchTheme(url: string, selected = false) {
    let themeJSON: any;

    if (url.startsWith(BUILTIN_PREFIX)) {
        // Built-in themes are generated on the device, against this Discord version's colour keys.
        themeJSON = getBuiltinTheme(url);
    } else try {
        themeJSON = await (await safeFetch(url, { cache: "no-store" })).json();
    } catch {
        throw new Error(`Failed to fetch theme at ${url}`);
    }

    // Validate theme
    if (!validateTheme(themeJSON)) throw new Error(`Invalid theme at ${url}`);

    themes[url] = {
        id: url,
        selected: selected,
        data: processData(themeJSON),
    };

    if (selected) {
        writeThemeToNative(themes[url]);
        updateBunnyColor(themes[url].data, { update: true });
    }
}

export async function installTheme(url: string) {
    if (typeof url !== "string" || url in themes) throw new Error("Theme already installed");
    await fetchTheme(url);
}

export function selectTheme(theme: VdThemeInfo | null, write = true) {
    announceSave(theme ? `Theme set: ${theme.data?.name ?? "theme"}` : "Theme turned off");
    // Deltacord's themes bring the Determination font; only for the user's own choices, not startup or Safe Mode.
    if (isUserTime() && !settings.safeMode?.enabled) onThemeChosen(theme?.id ?? null);
    if (theme) theme.selected = true;
    Object.keys(themes).forEach(
        k => themes[k].selected = themes[k].id === theme?.id
    );

    if (theme == null && write) {
        updateBunnyColor(null, { update: true });
        return writeThemeToNative({});
    } else if (theme) {
        updateBunnyColor(theme.data, { update: true });
        return writeThemeToNative(theme);
    }
}

export async function removeTheme(id: string) {
    const theme = themes[id];
    if (theme.selected) await selectTheme(null);
    delete themes[id];

    return theme.selected;
}

export async function updateThemes() {
    await awaitStorage(themes);
    const currentTheme = getThemeFromLoader();
    await Promise.allSettled(Object.keys(themes).map(id => fetchTheme(id, currentTheme?.id === id)));
}

export function getCurrentTheme() {
    return Object.values(themes).find(t => t.selected) ?? null;
}

/**
 * @internal
 */
export function getThemeFromLoader(): VdThemeInfo | null {
    return getStoredTheme();
}

/**
 * @internal
 */
export async function initThemes() {
    if (!isThemeSupported()) return;

    try {
        if (isPyonLoader()) {
            writeFile("../vendetta_theme.json", "null");
        }

        await newAwaitStorage(colorsPref);

        const currentTheme = getThemeFromLoader();
        initColors(currentTheme?.data ?? null);

        // Not in Safe Mode, where themes are off; they're added on the next normal launch.
        if (!isMinimalStartup() && !await startingInSafeMode()) {
            await installBuiltinThemes().catch(e => console.error("Failed to install built-in themes", e));
        }
        updateThemes().catch(e => console.error("Failed to update themes", e));
    } catch (e) {
        console.error("Failed to initialize themes", e);
    }
}

/**
 * Deltacord comes with its own themes (Deltarune, Light World, Crimson). Each is installed once;
 * after that they're kept up to date by updateThemes() like any other theme, and one the user
 * removes stays removed. Deltarune is switched on the first time.
 */
async function installBuiltinThemes() {
    await awaitStorage(themes, builtinFlags);
    const installed = { ...(builtinFlags.installed ?? {}) };
    let selectDeltarune = false;

    for (const id of BUILTIN_THEME_IDS) {
        if (installed[id]) continue;
        themes[id] = { id, selected: false, data: processData(buildBuiltinTheme(id)) };
        installed[id] = true;
        if (id === DELTARUNE_THEME_ID) selectDeltarune = true;
    }
    builtinFlags.installed = installed;

    if (selectDeltarune) {
        // Switch it on, unless the user picked a theme from somewhere else (Deltacord's own themes are fine to replace).
        const current = getCurrentTheme();
        if (!current || current.id.includes("/deltacord-bundle/")) await selectTheme(themes[DELTARUNE_THEME_ID]);
    }
}
