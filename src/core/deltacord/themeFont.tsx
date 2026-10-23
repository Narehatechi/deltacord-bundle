/**
 * Deltacord's own themes come with the Determination font.
 *
 * Choosing a built-in theme (Deltarune, Light World, Crimson) switches the font to Determination
 * and remembers the font you had; choosing any other theme puts your font back. Can be turned off
 * in Extras. Fonts are applied by the native side when Discord starts, so a change needs a reload.
 *
 * Only Discord's main, heading and code fonts are replaced. Its fallback fonts (NotoSans) are left
 * alone on purpose: Determination has no emoji, accents beyond Latin, or non-Latin scripts, so those
 * characters keep falling back to normal fonts instead of showing as boxes.
 */
import { FontDefinition, fonts, saveFont, selectFont } from "@lib/addons/fonts";
import { BUILTIN_THEME_IDS } from "@lib/addons/themes/builtin/deltarune";
import { awaitStorage } from "@core/vendetta/storage";
import { BundleUpdaterManager } from "@lib/api/native/modules";
import { openAlert } from "@lib/ui/alerts";
import { AlertActionButton, AlertActions, AlertModal } from "@metro/common/components";

import { extrasSettings, getExtras } from "./extras";

const FONT_URL = "https://raw.githubusercontent.com/Narehatechi/deltacord-bundle/main/themes/fonts/DeterminationMono.ttf";
export const THEME_FONT_NAME = "Determination";

const REPLACED = [
    "ggsans-Normal", "ggsans-Medium", "ggsans-Semibold", "ggsans-Bold", "ggsans-ExtraBold",
    "ggsans-NormalItalic", "ggsans-MediumItalic", "ggsans-SemiboldItalic", "ggsans-BoldItalic", "ggsans-ExtraBoldItalic",
    "ggmono-Normal", "ggmono-Bold",
    "ABCGintoNord-ExtraBold",
];

export const DETERMINATION_FONT: FontDefinition = {
    spec: 1,
    name: THEME_FONT_NAME,
    description: "Determination Mono by Abacadaba (CC BY-NC-ND), the font that comes with Deltacord's themes.",
    main: Object.fromEntries(REPLACED.map(name => [name, FONT_URL])),
};

const isBuiltinTheme = (id?: string | null) => !!id && BUILTIN_THEME_IDS.includes(id);
const selectedFont = () => (fonts as any).__selected as string | undefined;

/**
 * Makes the font match the theme. Returns true if the font changed (it shows after a reload).
 * `quiet`: no "Saved" toast (used at startup).
 */
export async function syncThemeFont(themeId: string | null | undefined, { quiet = false } = {}): Promise<boolean> {
    await awaitStorage(fonts, extrasSettings);
    const extras = getExtras();
    const current = selectedFont();

    if (isBuiltinTheme(themeId) && extras.themeFont) {
        if (current === THEME_FONT_NAME) return false;

        if (!fonts[THEME_FONT_NAME]) await saveFont(DETERMINATION_FONT);
        // Remember the user's own font so it can come back with a non-Deltacord theme.
        extrasSettings.fontBeforeTheme = current ?? null;
        extrasSettings.fontSetByTheme = true;
        await selectFont(THEME_FONT_NAME, quiet);
        return true;
    }

    // Leaving Deltacord's themes (or the pairing was switched off): restore the user's font.
    if (extrasSettings.fontSetByTheme && current === THEME_FONT_NAME) {
        const previous = extrasSettings.fontBeforeTheme;
        extrasSettings.fontSetByTheme = false;
        await selectFont(previous && fonts[previous] ? previous : null, quiet);
        return true;
    }
    return false;
}

/** After the user picks a theme: match the font and offer a reload so it shows. */
export async function onThemeChosen(themeId: string | null | undefined) {
    try {
        if (await syncThemeFont(themeId)) promptReload();
    } catch (e) {
        console.error("[Deltacord] Couldn't switch the theme font", e);
    }
}

export function promptReload(reason?: string) {
    openAlert(
        "deltacord-font-reload",
        <AlertModal
            title="Reload to change the font?"
            content={reason ?? "Fonts change when Discord restarts."}
            actions={<AlertActions>
                <AlertActionButton text="Reload now" variant="primary" onPress={() => BundleUpdaterManager.reload()} />
                <AlertActionButton text="Later" variant="secondary" />
            </AlertActions>}
        />
    );
}

/**
 * At startup: if a Deltacord theme is already on but its font isn't yet (first launch after this
 * update, or the very first launch), set it up and offer one reload so it shows straight away.
 */
export async function ensureThemeFontAtStartup(currentThemeId: string | null | undefined) {
    try {
        const changed = await syncThemeFont(currentThemeId, { quiet: true });
        if (changed && isBuiltinTheme(currentThemeId) && !extrasSettings.themeFontPrompted) {
            extrasSettings.themeFontPrompted = true;
            promptReload("Deltacord's themes now come with the Determination font. Reload to see it? (You can turn this off in Deltacord > Extras.)");
        }
    } catch (e) {
        console.error("[Deltacord] Couldn't set up the theme font", e);
    }
}
