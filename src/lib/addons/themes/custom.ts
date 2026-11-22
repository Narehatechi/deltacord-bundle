/**
 * Themes you make yourself in Deltacord's theme editor.
 *
 * A custom theme is just a palette (the same ~19 named colours Deltacord's own themes are made
 * of) plus a name and an optional background picture. It's turned into a full theme the same way
 * the built-in ones are: fitted to every colour key the running Discord version has.
 */
import { createMMKVBackend, createStorage, wrapSync } from "@core/vendetta/storage";
import chroma from "chroma-js";

import { buildTheme, Palette, VARIANTS } from "./builtin/deltarune";
import { VendettaThemeManifest } from "./colors/types";

export const CUSTOM_PREFIX = "deltacord://custom/";

export interface CustomTheme {
    id: string;
    name: string;
    description?: string;
    palette: Palette;
    background?: { url: string; alpha: number; } | null;
    /** Which theme it started from (for "reset to"). */
    base?: string;
    updatedAt?: number;
}

export const customThemes = wrapSync(createStorage<Record<string, CustomTheme>>(createMMKVBackend("DELTACORD_CUSTOM_THEMES")));

export const isCustomThemeId = (id?: string | null) => !!id && id.startsWith(CUSTOM_PREFIX);

/** A new id from a name ("My Theme" -> deltacord://custom/my-theme, made unique). */
export function newCustomId(name: string): string {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "theme";
    let id = CUSTOM_PREFIX + slug;
    for (let i = 2; customThemes[id]; i++) id = `${CUSTOM_PREFIX}${slug}-${i}`;
    return id;
}

/** Themes you can start from: Deltacord's own. */
export const STARTERS = Object.values(VARIANTS).map(v => ({ id: v.id, name: v.name, palette: v.palette, background: v.background ?? null }));

/**
 * The grey ramp (what Discord's greys are remapped onto), made from the palette's backgrounds
 * and text colours so every grey in Discord follows your choices.
 */
export function rampFor(p: Palette): [number, string][] {
    const mix = (a: string, b: string, t: number) => chroma.mix(a, b, t, "lab").hex();
    return [
        [0, p.void], [0.06, p.void], [0.1, mix(p.void, p.bg1, 0.5)], [0.13, p.bg1], [0.17, p.bg2],
        [0.22, p.bg3], [0.28, p.bg4], [0.36, p.bg5], [0.46, p.disabled], [0.56, p.faint],
        [0.66, mix(p.faint, p.muted, 0.5)], [0.76, p.muted], [0.86, mix(p.muted, p.text, 0.6)],
        [0.94, mix(p.muted, p.text, 0.85)], [1, p.text],
    ];
}

/** The full theme for a custom one. */
export function buildCustomTheme(theme: CustomTheme): VendettaThemeManifest {
    const built = buildTheme({
        id: theme.id,
        name: theme.name,
        description: theme.description ?? "Made in Deltacord's theme editor.",
        palette: theme.palette,
        ramp: rampFor(theme.palette),
        background: theme.background?.url ? theme.background : undefined,
    });
    built.name = theme.name;
    built.description = theme.description ?? "Made in Deltacord's theme editor.";
    built.authors = [{ name: "You (theme editor)", id: "0" }] as any;
    return built;
}

/** Fixes up a palette from anywhere (a pack, an old version): every colour present and valid. */
export function cleanPalette(p: Partial<Palette> | undefined, fallback: Palette = VARIANTS.deltarune.palette): Palette {
    const out: any = {};
    for (const key of Object.keys(fallback) as (keyof Palette)[]) {
        const value = p?.[key];
        out[key] = typeof value === "string" && chroma.valid(value) ? chroma(value).hex() : fallback[key];
    }
    return out;
}
