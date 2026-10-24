/**
 * Translate: /translate sends your text in another language; /translate-preview shows a
 * translation only to you (paste a message you got into it to read it).
 * Uses Google Translate's free web endpoint.
 */
import { defineCorePlugin } from "..";
import { option, registerCommands, reply } from "../shared";

const STRING = 3;

export const LANGUAGES: Record<string, string> = {
    english: "en", spanish: "es", french: "fr", german: "de", italian: "it", portuguese: "pt", russian: "ru",
    japanese: "ja", korean: "ko", chinese: "zh-CN", arabic: "ar", hindi: "hi", turkish: "tr", polish: "pl",
    dutch: "nl", swedish: "sv", ukrainian: "uk", vietnamese: "vi", indonesian: "id", thai: "th", greek: "el",
    hebrew: "iw", finnish: "fi", norwegian: "no", danish: "da", czech: "cs", romanian: "ro", hungarian: "hu",
    tagalog: "tl", latin: "la",
};

/** "spanish", "Spanish", "es" → "es". */
export function languageCode(input: string | undefined, fallback = "en"): string {
    const value = String(input ?? "").trim().toLowerCase();
    if (!value) return fallback;
    if (LANGUAGES[value]) return LANGUAGES[value];
    // "jap" → Japanese; a two-letter or region code ("ja", "pt-br") is used as it is.
    const prefix = value.length >= 3 ? Object.keys(LANGUAGES).find(name => name.startsWith(value)) : undefined;
    if (prefix) return LANGUAGES[prefix];
    if (/^[a-z]{2,3}(-[a-z]{2})?$/i.test(value)) return value.replace(/-([a-z]{2})$/i, (_, r) => `-${r.toUpperCase()}`);
    return fallback;
}

const nameOf = (code: string) => Object.keys(LANGUAGES).find(k => LANGUAGES[k] === code) ?? code;

export async function translate(text: string, to: string, from = "auto"): Promise<{ text: string; from: string; }> {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl=${encodeURIComponent(from)}&tl=${encodeURIComponent(to)}&q=${encodeURIComponent(text)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Translation failed (${res.status})`);
    const data = await res.json();
    const out = (data?.[0] ?? []).map((part: any) => part?.[0] ?? "").join("");
    return { text: out, from: data?.[2] ?? from };
}

let undo: (() => void) | undefined;

const textOption = { name: "text", displayName: "text", description: "What to translate", type: STRING, required: true };
const toOption = { name: "to", displayName: "to", description: "Language (like spanish, japanese or es). Default English.", type: STRING };

export default defineCorePlugin({
    manifest: {
        id: "deltacord.translate",
        name: "Translate",
        version: "1.0.0",
        description: "/translate sends text in another language; /translate-preview shows a translation only to you.",
        authors: [{ name: "Deltacord" }],
    },
    start() {
        undo = registerCommands([
            {
                name: "translate",
                description: "Send text translated into another language",
                options: [textOption, toOption],
                async execute(args: any[], ctx: any) {
                    const to = languageCode(option(args, "to"));
                    try {
                        const result = await translate(String(option(args, "text") ?? ""), to);
                        return { content: result.text };
                    } catch (e: any) {
                        reply(ctx.channel.id, `Couldn't translate: ${e?.message ?? e}`);
                    }
                },
            },
            {
                name: "translate-preview",
                description: "Translate text for yourself (nothing is sent)",
                options: [textOption, toOption],
                async execute(args: any[], ctx: any) {
                    const to = languageCode(option(args, "to"));
                    try {
                        const result = await translate(String(option(args, "text") ?? ""), to);
                        reply(ctx.channel.id, `**${nameOf(result.from)} → ${nameOf(to)}**\n${result.text}`);
                    } catch (e: any) {
                        reply(ctx.channel.id, `Couldn't translate: ${e?.message ?? e}`);
                    }
                },
            },
        ]);
    },
    stop() {
        undo?.();
        undo = undefined;
    },
} as any);
