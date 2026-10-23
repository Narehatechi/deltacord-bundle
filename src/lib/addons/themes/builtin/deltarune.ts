/**
 * Deltacord's built-in "Deltarune" theme.
 *
 * Instead of a fixed list of colours, this reads every raw and semantic colour key the
 * running Discord build actually has and gives each one a Deltarune-style colour, so the
 * whole app is covered, including keys that only exist in newer Discord versions.
 *
 * Raw colours (Discord's palette scales) are remapped first, so anything we don't name
 * explicitly still inherits the new palette. Semantic colours are then assigned by what
 * their names say they are for (backgrounds, text, borders, danger, mentions and so on).
 *
 * Palette, colours only (no game art): pitch-black "dark world" backgrounds with a faint
 * indigo undertone, white text and box borders, yellow for whatever is selected, orange
 * buttons, cyan links, and the game's bright red / green / yellow status colours.
 */
import { findByProps } from "@metro";
import chroma from "chroma-js";

import { VendettaThemeManifest } from "../colors/types";
import { _colorRef } from "../colors/updater";

export const DELTARUNE_THEME_ID = "deltacord://builtin/deltarune";
const ASSETS = "https://raw.githubusercontent.com/Narehatechi/deltacord-bundle/main/themes";

export interface Palette {
    void: string; bg1: string; bg2: string; bg3: string; bg4: string; bg5: string;
    text: string; muted: string; faint: string; disabled: string;
    /** "Selected" colour (the game's yellow). */
    yellow: string;
    /** Accent: buttons, brand, progress bars. */
    orange: string;
    red: string; green: string; cyan: string; pink: string; purple: string; teal: string;
}

export interface Variant {
    id: string;
    name: string;
    description: string;
    palette: Palette;
    /** Grey ramp indexed by the original colour's lightness (0..1). */
    ramp: [number, string][];
    background?: { url: string; alpha: number; };
}

const BASE_COLOURS = { yellow: "#FFFF00", red: "#FF2A2A", green: "#22E022", pink: "#FF66CC", purple: "#8A4DFF", teal: "#00E5C8" };

export const VARIANTS: Record<string, Variant> = {
    deltarune: {
        id: DELTARUNE_THEME_ID,
        name: "Deltarune",
        description: "Built into Deltacord. Pitch-black dark world, white boxes, yellow for whatever's selected, orange buttons. Fitted to every colour in your Discord version.",
        palette: {
            ...BASE_COLOURS,
            void: "#000000", bg1: "#05030A", bg2: "#0C0816", bg3: "#151026", bg4: "#211838", bg5: "#2E2250",
            text: "#FFFFFF", muted: "#B4AEC8", faint: "#7D7694", disabled: "#5A546E",
            orange: "#FF7F27", cyan: "#00C8FF",
        },
        ramp: [
            [0, "#000000"], [0.06, "#000000"], [0.1, "#020105"], [0.13, "#05030A"], [0.17, "#0C0816"],
            [0.22, "#151026"], [0.28, "#211838"], [0.36, "#332A4D"], [0.46, "#544C6B"], [0.56, "#7D7694"],
            [0.66, "#A39DB6"], [0.76, "#C6C1D6"], [0.86, "#E4E1ED"], [0.94, "#F5F4F9"], [1, "#FFFFFF"],
        ],
        background: { url: `${ASSETS}/deltarune/background.png`, alpha: 0.32 },
    },
    lightworld: {
        id: "deltacord://builtin/lightworld",
        name: "Light World",
        description: "Built into Deltacord. Undertale-style black and white: plain black boxes, white text, yellow for whatever's selected, orange buttons.",
        palette: {
            ...BASE_COLOURS, green: "#00E000",
            void: "#000000", bg1: "#050505", bg2: "#0C0C0C", bg3: "#171717", bg4: "#242424", bg5: "#363636",
            text: "#FFFFFF", muted: "#BDBDBD", faint: "#848484", disabled: "#5C5C5C",
            orange: "#FF8A1E", cyan: "#7FD4FF",
        },
        ramp: [
            [0, "#000000"], [0.06, "#000000"], [0.1, "#020202"], [0.13, "#050505"], [0.17, "#0C0C0C"],
            [0.22, "#171717"], [0.28, "#242424"], [0.36, "#383838"], [0.46, "#5C5C5C"], [0.56, "#848484"],
            [0.66, "#A8A8A8"], [0.76, "#C9C9C9"], [0.86, "#E6E6E6"], [0.94, "#F6F6F6"], [1, "#FFFFFF"],
        ],
        background: { url: `${ASSETS}/lightworld/background.png`, alpha: 0.28 },
    },
    crimson: {
        id: "deltacord://builtin/crimson",
        name: "Deltarune: Crimson",
        description: "Built into Deltacord. The dark world in a deep red mood: crimson accents, rose links, yellow for whatever's selected.",
        palette: {
            ...BASE_COLOURS, red: "#FF4040",
            void: "#000000", bg1: "#0A0204", bg2: "#14050A", bg3: "#200912", bg4: "#33101D", bg5: "#4A1729",
            text: "#FFFFFF", muted: "#D4B0BC", faint: "#9A7380", disabled: "#6A4A55",
            orange: "#FF3B5C", cyan: "#FF9EC4",
        },
        ramp: [
            [0, "#000000"], [0.06, "#000000"], [0.1, "#050102"], [0.13, "#0A0204"], [0.17, "#14050A"],
            [0.22, "#200912"], [0.28, "#33101D"], [0.36, "#4D1E2E"], [0.46, "#6E4352"], [0.56, "#9A7380"],
            [0.66, "#B898A3"], [0.76, "#D4BCC4"], [0.86, "#EADDE1"], [0.94, "#F8F2F4"], [1, "#FFFFFF"],
        ],
        background: { url: `${ASSETS}/crimson/background.png`, alpha: 0.3 },
    },
};

export const BUILTIN_THEME_IDS = Object.values(VARIANTS).map(v => v.id);

/** The palette being generated right now (set by buildTheme). */
export let P: Palette = VARIANTS.deltarune.palette;
let NEUTRAL_RAMP = VARIANTS.deltarune.ramp;

/** "#RRGGBB" + alpha byte, e.g. tint(P.yellow, 0x29). */
const tint = (color: string, alpha: number) => chroma(color).alpha(alpha / 255).hex();

// ---------------------------------------------------------------- raw colours
//
// Discord's palette has ~1,700 keys in many numbering schemes (PRIMARY_600, PLUM_0..26,
// BLUE_NEW_1..100, OPACITY_BLURPLE_12...). Rather than matching numbers, each colour is
// remapped by what it looks like: greys by brightness onto a black-to-lavender ramp,
// colours by keeping their brightness and swapping in a Deltarune hue.

/** Palettes that mean something specific (Nitro, roles, illustrations, partner brands): left alone. */
const KEEP = /^(CHECKPOINT|PREMIUM|ROLE|GUILD|PLATFORM|HYPESQUAD|APPLICATION|BG_GRADIENT|BG_ANIMATED|ILLO|SPOTIFY|TWITCH|YOUTUBE|XBOX|PLAYSTATION|REDDIT|TWITTER|FACEBOOK|INSTAGRAM|TIKTOK|STEAM|BATTLENET|CRUNCHYROLL|PARTNER|GUILD_BOOSTING|BOOST|NITRO|HOLIDAY|WHITE$|BLACK$|TRANSPARENT$)/;

function neutralFor(lightness: number): string {
    for (let i = 1; i < NEUTRAL_RAMP.length; i++) {
        const [hi, hiColor] = NEUTRAL_RAMP[i];
        if (lightness <= hi) {
            const [lo, loColor] = NEUTRAL_RAMP[i - 1];
            return chroma.mix(loColor, hiColor, (lightness - lo) / (hi - lo || 1), "rgb").hex();
        }
    }
    return "#FFFFFF";
}

type Hue = "orange" | "red" | "green" | "yellow" | "cyan" | "pink" | "purple" | "teal";
/** Hue and saturation for each colour family, taken from the current palette. */
let HUES = {} as Record<Hue, [number, number]>;

function setHuesFromPalette() {
    const hs = (c: string): [number, number] => {
        const [h, sat] = chroma(c).hsl();
        return [Number.isNaN(h) ? 0 : h, Math.max(0.6, sat)];
    };
    HUES = {
        orange: hs(P.orange), red: hs(P.red), green: hs(P.green), yellow: hs(P.yellow),
        cyan: hs(P.cyan), pink: hs(P.pink), purple: hs(P.purple), teal: hs(P.teal),
    };
}

function familyHue(key: string): Hue | "neutral" | null {
    if (/^(OPACITY_)?(BRAND|BLURPLE)(_|$)/.test(key)) return "orange";
    if (/^(OPACITY_)?(PRIMARY|NEUTRAL|PLUM|GREY|GRAY)(_|$)/.test(key)) return "neutral";
    if (/^OPACITY_(WHITE|BLACK)?(_|\d|$)/.test(key)) return "neutral";
    if (/^(OPACITY_)?RED(_|$)/.test(key)) return "red";
    if (/^(OPACITY_)?GREEN(_|$)/.test(key)) return "green";
    if (/^(OPACITY_)?YELLOW(_|$)/.test(key)) return "yellow";
    if (/^(OPACITY_)?ORANGE(_|$)/.test(key)) return "orange";
    if (/^(OPACITY_)?(BLUE|SKY|CYAN)(_|$)/.test(key)) return "cyan";
    if (/^(OPACITY_)?TEAL(_|$)/.test(key)) return "teal";
    if (/^(OPACITY_)?(PINK|MAGENTA|FUCHSIA)(_|$)/.test(key)) return "pink";
    if (/^(OPACITY_)?(PURPLE|VIOLET|INDIGO)(_|$)/.test(key)) return "purple";
    return null;
}

function hueOfColor(color: chroma.Color): Hue | "neutral" {
    const [h, s] = color.hsl();
    if (!(s > 0.18) || Number.isNaN(h)) return "neutral";
    if (h < 15 || h >= 345) return "red";
    if (h < 45) return "orange";
    if (h < 70) return "yellow";
    if (h < 160) return "green";
    if (h < 185) return "teal";
    if (h < 215) return "cyan";
    if (h < 275) return "orange"; // Discord's blurple brand range becomes our orange
    if (h < 300) return "purple";
    return "pink";
}

/** Maps one raw palette colour to its Deltarune version, or undefined to leave it alone. */
export function rawColorFor(key: string, original: string | undefined): string | undefined {
    if (!original || KEEP.test(key) || !chroma.valid(original)) return undefined;

    const color = chroma(original);
    const alpha = color.alpha();
    const hue = familyHue(key) ?? hueOfColor(color);
    const lightness = color.hsl()[2];

    let out: chroma.Color;
    if (hue === "neutral") {
        out = chroma(neutralFor(lightness));
    } else {
        const [h, sat] = HUES[hue];
        // Keep the shade (light/dark step of the scale), swap in the Deltarune hue.
        out = chroma.hsl(h, sat, Math.min(0.97, Math.max(0.04, lightness)));
    }
    return out.alpha(alpha).hex();
}

// ----------------------------------------------------------- semantic colours

/** Exact keys that deserve a hand-picked colour. Checked before the name-based rules. */
let EXACT: Record<string, string> = {};
const buildExact = (): Record<string, string> => ({
    TEXT_LINK: P.cyan,
    TEXT_BRAND: P.orange,
    CHANNELS_DEFAULT: P.muted,
    CHANNEL_ICON: P.muted,
    CHANNEL_TEXT_AREA_PLACEHOLDER: P.faint,
    INPUT_PLACEHOLDER_TEXT: P.faint,
    TEXT_INPUT_PLACEHOLDER: P.faint,

    STATUS_ONLINE: P.green,
    STATUS_IDLE: P.yellow,
    STATUS_DND: P.red,
    STATUS_OFFLINE: P.faint,
    STATUS_STREAMING: P.purple,

    MENTION_FOREGROUND: P.yellow,
    MENTION_BACKGROUND: tint(P.yellow, 0x29),
    BACKGROUND_MENTIONED: tint(P.yellow, 0x14),
    BACKGROUND_MENTIONED_HOVER: tint(P.yellow, 0x1F),
    BACKGROUND_MESSAGE_HIGHLIGHT: tint(P.yellow, 0x14),
    BACKGROUND_MESSAGE_HIGHLIGHT_HOVER: tint(P.yellow, 0x1F),
    BACKGROUND_MESSAGE_AUTOMOD: tint(P.red, 0x14),
    BACKGROUND_MESSAGE_AUTOMOD_HOVER: tint(P.red, 0x1F),
    BACKGROUND_MESSAGE_HOVER: "#FFFFFF0A",

    // Discord's main buttons: orange like the game's menu buttons, black text on top.
    REDESIGN_BUTTON_PRIMARY_BACKGROUND: P.orange,
    REDESIGN_BUTTON_PRIMARY_PRESSED_BACKGROUND: chroma.mix(P.orange, "#000000", 0.2, "rgb").hex(),
    REDESIGN_BUTTON_PRIMARY_TEXT: "#000000",
    REDESIGN_BUTTON_PRIMARY_ALT_BACKGROUND: P.yellow,
    REDESIGN_BUTTON_PRIMARY_ALT_TEXT: "#000000",
    REDESIGN_BUTTON_SECONDARY_BACKGROUND: P.bg3,
    REDESIGN_BUTTON_SECONDARY_PRESSED_BACKGROUND: P.bg4,
    REDESIGN_BUTTON_SECONDARY_TEXT: P.text,
    REDESIGN_BUTTON_TERTIARY_BACKGROUND: P.bg2,
    REDESIGN_BUTTON_TERTIARY_PRESSED_BACKGROUND: P.bg3,
    REDESIGN_BUTTON_TERTIARY_TEXT: P.text,
    REDESIGN_BUTTON_DANGER_BACKGROUND: P.red,
    REDESIGN_BUTTON_DANGER_TEXT: "#000000",
    REDESIGN_BUTTON_POSITIVE_BACKGROUND: P.green,
    REDESIGN_BUTTON_POSITIVE_TEXT: "#000000",
    REDESIGN_BUTTON_OVERLAY_BACKGROUND: "#000000B3",
    REDESIGN_BUTTON_OVERLAY_TEXT: P.text,
    REDESIGN_CHANNEL_NAME_TEXT: P.text,
    REDESIGN_CHANNEL_CATEGORY_NAME_TEXT: P.muted,
    REDESIGN_CHANNEL_MESSAGE_PREVIEW_TEXT: P.muted,

    CONTROL_BRAND_FOREGROUND: P.orange,
    CONTROL_BRAND_FOREGROUND_NEW: P.orange,
    SPOILER_HIDDEN_BACKGROUND: P.bg5,
    SPOILER_REVEALED_BACKGROUND: P.bg3,

    // Unread badges, send button, toggles: the bits that must pop.
    BADGE_NOTIFICATION_BACKGROUND: P.red,
    BADGE_BACKGROUND_DEFAULT: P.bg4,
    CHAT_INPUT_SEND_BUTTON_ACTIVE_BACKGROUND: P.orange,
    CHAT_INPUT_SEND_BUTTON_ICON_ACTIVE_TINT: "#000000",
    SWITCH_BACKGROUND_DEFAULT: P.bg3,
    SWITCH_BACKGROUND_SELECTED_DEFAULT: P.yellow,
    SWITCH_THUMB_BACKGROUND_DEFAULT: P.muted,
    SWITCH_THUMB_BACKGROUND_SELECTED_DEFAULT: "#000000",
    SWITCH_THUMB_ICON_DEFAULT: P.bg3,
    SWITCH_THUMB_ICON_ACTIVE: P.yellow,
    SWITCH_BORDER_SELECTED_DEFAULT: P.yellow,
    CHECKBOX_BACKGROUND_SELECTED_DEFAULT: P.yellow,
    CHECKBOX_BORDER_SELECTED_DEFAULT: P.yellow,
    CHECKBOX_ICON_ACTIVE: "#000000",
    REDESIGN_INPUT_CONTROL_SELECTED: P.yellow,
    MOBILE_SEGMENTED_CONTROL_INDICATOR_BACKGROUND: P.bg4,
    MOBILE_SEGMENTED_CONTROL_BACKGROUND: P.bg2,
    TAB_LABEL_TEXT_FOCUSED: P.yellow,
    REACTION_BACKGROUND_DEFAULT: P.bg2,
    REACTION_BACKGROUND_REACTED_DEFAULT: tint(P.yellow, 0x1A),
    REACTION_BORDER_REACTED_DEFAULT: P.yellow,
    REACTION_TEXT_REACTED_DEFAULT: P.yellow,
    PROGRESSBAR_INDICATOR_BACKGROUND: P.orange,
    PROGRESSBAR_TRACK_BACKGROUND: P.bg3,
    ACTIVITY_TIMEBAR_PROGRESS_BACKGROUND: P.orange,
    GRADIENT_PROGRESS_PILL_BACKGROUND: P.bg3,
    SLIDER_TRACK_BACKGROUND: P.bg3,
    MOBILE_ANDROID_BUTTON_BACKGROUND_RIPPLE: "#FFFFFF1F",
    MOBILE_TOAST_BACKGROUND_DEFAULT: P.bg2,
    CUSTOM_STATUS_BUBBLE_BG: P.bg2,

    ANDROID_NAVIGATION_BAR_BACKGROUND: P.void,
    ANDROID_NAVIGATION_SCRIM_BACKGROUND: "#000000CC",
    DEPRECATED_STORE_BG: P.void,
});

type Tone = "red" | "green" | "yellow" | "orange" | "cyan" | "purple" | "mention" | "faint" | "spoiler" | null;

function toneOf(k: string): Tone {
    if (/SPOILER/.test(k)) return "spoiler";
    if (/(MENTION|HIGHLIGHT)/.test(k)) return "mention";
    if (/(DANGER|CRITICAL|ERROR|DESTRUCTIVE|NEGATIVE|STATUS_DND|(^|_)(RED|NOTIFICATION)(_|$))/.test(k)) return "red";
    if (/(POSITIVE|SUCCESS|ONLINE|(^|_)GREEN(_|$))/.test(k)) return "green";
    if (/(WARNING|IDLE|CAUTION|(^|_)YELLOW(_|$))/.test(k)) return "yellow";
    if (/(LINK|(^|_)INFO(_|$))/.test(k)) return "cyan";
    if (/(BRAND|BLURPLE|PREMIUM)/.test(k)) return "orange";
    if (/(STREAMING|(^|_)PURPLE(_|$))/.test(k)) return "purple";
    if (/(OFFLINE|INVISIBLE)/.test(k)) return "faint";
    return null;
}

const BG = /(BACKGROUND|^BG_|_BG(_|$)|SURFACE|CARD|CONTAINER|MODAL|SHEET|PANEL|OVERLAY|BACKDROP|SCRIM|FILL)/;
const BORDER = /(BORDER|DIVIDER|OUTLINE|SEPARATOR|STROKE)/;
const FOREGROUND = /(TEXT|HEADER|HEADING|LABEL|TITLE|ICON|INTERACTIVE|GLYPH|FOREGROUND)/;
/** Matches whole underscore-separated words only, so INTERACTIVE does not count as ACTIVE. */
const word = (...words: string[]) => new RegExp(`(^|_)(${words.join("|")})(_|$)`);
const PRESSED = word("HOVER", "ACTIVE", "PRESSED", "SELECTED", "FOCUSED");
const SELECTED = word("SELECTED", "ACTIVE", "FOCUSED");

/** Solid colour for buttons, badges and fills; a tinted dark panel for notices and banners. */
function tonedBackground(k: string, color: string): string {
    if (/DISABLED/.test(k)) return chroma.mix(P.void, color, 0.4, "rgb").hex();
    const subtle = /(FEEDBACK|INFO|MESSAGE|NOTICE|BANNER|SUBTLE|FAINT|MUTED|TINT|CALLOUT|OUTLINE|SECONDARY|TERTIARY)/.test(k);
    if (subtle) return chroma.mix(P.void, color, PRESSED.test(k) ? 0.26 : 0.18, "rgb").hex();
    return PRESSED.test(k) ? chroma.mix(color, "#000000", 0.25, "rgb").hex() : color;
}

/** Picks a Deltarune colour for one semantic key, or undefined to let the raw palette decide. */
export function semanticColorFor(k: string): string | undefined {
    if (EXACT[k]) return EXACT[k];
    if (/(EXPRESSIVE_GRADIENT|TENURE|PREMIUM|NITRO|GRADIENT_(START|END)$)/.test(k)) return undefined;

    if (/SCROLLBAR/.test(k)) return /THUMB/.test(k) ? "#FFFFFF66" : P.void;

    // Text/icon slots win over background-ish words in their names (TEXT_OVERLAY_LIGHT, CARD_TITLE_TEXT...).
    if (/OVERLAY_DARK$/.test(k) && FOREGROUND.test(k)) return "#000000";
    if (/OVERLAY_LIGHT$/.test(k) && FOREGROUND.test(k)) return P.text;

    const tone = toneOf(k);
    const namesBackground = /(BACKGROUND|(^|_)BG(_|$)|FILL)/.test(k);
    const isBorder = BORDER.test(k) && !namesBackground && (/(BORDER|DIVIDER|SEPARATOR|STROKE)/.test(k) || !FOREGROUND.test(k));
    const isBg = BG.test(k) && !isBorder && (namesBackground || !FOREGROUND.test(k));

    // TEXT_ON_BRAND, ICON_ON_DANGER...: sits on a coloured fill, so dark text like the game's buttons.
    if (/(^|_)ON_/.test(k) && !isBg && !isBorder) return tone ? "#000000" : P.text;

    switch (tone) {
        case "mention":
            if (isBg) return tint(P.yellow, PRESSED.test(k) ? 0x26 : 0x17);
            return P.yellow;
        case "spoiler":
            return /REVEALED/.test(k) ? P.bg3 : P.bg5;
        case "faint":
            return isBg ? P.bg3 : P.faint;
        case "red": case "green": case "yellow": case "orange": case "cyan": case "purple": {
            const color = P[tone];
            if (isBg) return tonedBackground(k, color);
            return color;
        }
    }

    if (isBorder) {
        if (/STRONG|FOCUS/.test(k) || SELECTED.test(k)) return P.text;
        if (/(FAINT|SUBTLE|MUTED)/.test(k)) return "#FFFFFF2E";
        return "#FFFFFF5C";
    }

    if (isBg) {
        if (/(BACKDROP|SCRIM)/.test(k)) return "#000000D9";
        if (/(MODIFIER|(^|_)MOD(_|$))/.test(k)) {
            if (SELECTED.test(k) || /PRESSED|STRONG/.test(k)) return "#FFFFFF2E";
            if (/HOVER|SUBTLE/.test(k)) return "#FFFFFF1C";
            if (/FAINT/.test(k)) return "#FFFFFF0F";
            return "#FFFFFF1C";
        }
        if (SELECTED.test(k) || /PRESSED/.test(k)) return P.bg4;
        if (/HOVER/.test(k)) return P.bg3;
        if (/(HIGHEST)/.test(k)) return P.bg3;
        if (/(FLOATING|OVERLAY|RAISED|MODAL|SHEET|POPOUT|TOOLTIP|MENU|ELEVATED|HIGHER|HIGH(_|$)|NESTED)/.test(k)) return P.bg2;
        if (/(SECONDARY_ALT|ACCENT)/.test(k)) return P.bg2;
        if (/(TERTIARY|LOWEST|LOWER)/.test(k)) return P.void;
        if (/(SECONDARY|(^|_)LOW(_|$))/.test(k)) return P.bg1;
        if (/(CARD|CONTAINER|INPUT|SURFACE|FILL)/.test(k)) return P.bg2;
        return P.void;
    }

    if (FOREGROUND.test(k)) {
        if (/DISABLED/.test(k)) return P.disabled;
        // Like the game's menus: whatever you're on turns yellow.
        if (SELECTED.test(k)) return P.yellow;
        if (/(PLACEHOLDER|FAINT)/.test(k)) return P.faint;
        if (/(MUTED|SECONDARY|SUBTLE|TERTIARY|DESCRIPTION|HINT|LOW)/.test(k)) return P.muted;
        return P.text;
    }

    return undefined;
}

// ------------------------------------------------------------- contrast fix

/**
 * Text/icon slots usually have a matching background slot (CONTROL_CRITICAL_PRIMARY_TEXT_DEFAULT /
 * CONTROL_CRITICAL_PRIMARY_BACKGROUND_DEFAULT). If the two ended up too close (red on red,
 * orange on orange), the text becomes black or white, whichever reads better.
 */
function fixContrast(semanticColors: Record<string, string[]>) {
    for (const key of Object.keys(semanticColors)) {
        if (!/(TEXT|ICON|FOREGROUND|LABEL|GLYPH|TINT)/.test(key) || /(BACKGROUND|(^|_)BG(_|$)|BORDER)/.test(key)) continue;

        const candidates = new Set<string>();
        for (const fg of ["TEXT", "ICON", "FOREGROUND", "LABEL", "GLYPH", "ICON_TINT", "TINT"]) {
            // Only real pairs: there must be a shared prefix before the text word (X_TEXT / X_BACKGROUND).
            if (key.indexOf(`_${fg}`) <= 0) continue;
            candidates.add(key.replace(fg, "BACKGROUND"));
            candidates.add(key.replace(fg, "BG"));
            candidates.add(key.replace(`_${fg}`, "_BACKGROUND"));
        }

        for (const bgKey of candidates) {
            const bg = semanticColors[bgKey]?.[0];
            const fg = semanticColors[key][0];
            if (!bg || !chroma.valid(bg) || !chroma.valid(fg) || chroma(bg).alpha() < 0.9) continue;
            if (chroma.contrast(fg, bg) >= 3) break;

            const better = chroma.contrast("#000000", bg) >= chroma.contrast("#FFFFFF", bg) ? "#000000" : "#FFFFFF";
            semanticColors[key] = [better, better];
            break;
        }
    }
}

// --------------------------------------------------------------------- build

const tokenRef = findByProps("SemanticColor");

/** Builds a variant against the colour keys of the Discord build that is running right now. */
export function buildTheme(variant: Variant): VendettaThemeManifest {
    P = variant.palette;
    NEUTRAL_RAMP = variant.ramp;
    setHuesFromPalette();
    EXACT = buildExact();

    const rawColors: Record<string, string> = {};
    // Discord's untouched palette, captured before any theme was applied.
    const originalRaw: Record<string, string> = _colorRef.origRaw ?? tokenRef?.RawColor ?? {};
    for (const [key, original] of Object.entries<string>(originalRaw)) {
        const color = rawColorFor(key, original);
        if (color) rawColors[key] = color;
    }

    const semanticColors: Record<string, string[]> = {};
    for (const key of Object.keys(tokenRef?.SemanticColor ?? {})) {
        const color = semanticColorFor(key);
        if (color) semanticColors[key] = [color, color];
    }

    fixContrast(semanticColors);

    return {
        spec: 2,
        name: variant.name,
        description: variant.description,
        authors: [{ name: "Deltacord", id: "0" }],
        semanticColors,
        rawColors,
        ...(variant.background ? { background: { url: variant.background.url, blur: 0, alpha: variant.background.alpha } } : {}),
    };
}

export const buildDeltaruneTheme = () => buildTheme(VARIANTS.deltarune);

/** Builds a built-in theme by its deltacord://builtin/ id. */
export function buildBuiltinTheme(id: string): VendettaThemeManifest {
    const variant = Object.values(VARIANTS).find(v => v.id === id);
    if (!variant) throw new Error(`Unknown built-in theme ${id}`);
    return buildTheme(variant);
}
