/**
 * Fancy Text: /fancy writes your text in Unicode letter styles (𝓼𝓬𝓻𝓲𝓹𝓽, 𝖋𝖗𝖆𝖐𝖙𝖚𝖗, ｗｉｄｅ…)
 * that show up everywhere, no Nitro needed.
 */
import { defineCorePlugin } from "..";
import { option, registerCommands, reply } from "../shared";

const STRING = 3, BOOLEAN = 5;

/** Maps A-Z, a-z (and 0-9 where the style has digits) from a starting code point. */
function alphabet(upper: number, lower: number, digits?: number, exceptions: Record<string, string> = {}) {
    return (text: string) => [...text].map(c => {
        if (exceptions[c]) return exceptions[c];
        const code = c.charCodeAt(0);
        if (code >= 65 && code <= 90) return String.fromCodePoint(upper + code - 65);
        if (code >= 97 && code <= 122) return String.fromCodePoint(lower + code - 97);
        if (digits !== undefined && code >= 48 && code <= 57) return String.fromCodePoint(digits + code - 48);
        return c;
    }).join("");
}

const fromTable = (from: string, to: string[]) => (text: string) =>
    [...text].map(c => {
        const i = from.indexOf(c);
        return i >= 0 ? to[i] : c;
    }).join("");

const SMALL_CAPS = fromTable("abcdefghijklmnopqrstuvwxyz", [..."ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘǫʀꜱᴛᴜᴠᴡxʏᴢ"]);
const UPSIDE_FROM = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,!?'\"()[]{}<>_&";
const UPSIDE_TO = [..."ɐqɔpǝɟƃɥᴉɾʞlɯuodbɹsʇnʌʍxʎz∀ꓭƆꓷƎℲ⅁HIſꓘ˥WNOԀꝹꓤSꓕՈΛMX⅄Z0ƖᄅƐㄣϛ9ㄥ86˙'¡¿,„)(][}{><‾⅋"];

export const STYLES: Record<string, { label: string; apply: (t: string) => string; }> = {
    script: { label: "𝓢𝓬𝓻𝓲𝓹𝓽", apply: alphabet(0x1D4D0, 0x1D4EA) },
    bold: { label: "𝐁𝐨𝐥𝐝", apply: alphabet(0x1D400, 0x1D41A, 0x1D7CE) },
    italic: { label: "𝘐𝘵𝘢𝘭𝘪𝘤", apply: alphabet(0x1D608, 0x1D622) },
    fraktur: { label: "𝕱𝖗𝖆𝖐𝖙𝖚𝖗", apply: alphabet(0x1D56C, 0x1D586) },
    double: { label: "𝔻𝕠𝕦𝕓𝕝𝕖", apply: alphabet(0x1D538, 0x1D552, 0x1D7D8, { C: "ℂ", H: "ℍ", N: "ℕ", P: "ℙ", Q: "ℚ", R: "ℝ", Z: "ℤ" }) },
    mono: { label: "𝙼𝚘𝚗𝚘", apply: alphabet(0x1D670, 0x1D68A, 0x1D7F6) },
    wide: { label: "Ｗｉｄｅ", apply: (t: string) => [...t].map(c => (c >= "!" && c <= "~" ? String.fromCharCode(c.charCodeAt(0) + 0xFEE0) : c === " " ? "　" : c)).join("") },
    smallcaps: { label: "Sᴍᴀʟʟ ᴄᴀᴘs", apply: SMALL_CAPS },
    bubble: { label: "Ⓑⓤⓑⓑⓛⓔ", apply: alphabet(0x24B6, 0x24D0) },
    upsidedown: { label: "uʍop ǝpᴉsdn", apply: (t: string) => [...fromTable(UPSIDE_FROM, UPSIDE_TO)(t)].reverse().join("") },
    strike: { label: "S̶t̶r̶i̶k̶e̶", apply: (t: string) => [...t].map(c => c + "̶").join("") },
};

let undo: (() => void) | undefined;

export default defineCorePlugin({
    manifest: {
        id: "deltacord.fancytext",
        name: "Fancy Text",
        version: "1.0.0",
        description: "/fancy writes text in 𝓼𝓬𝓻𝓲𝓹𝓽, 𝖋𝖗𝖆𝖐𝖙𝖚𝖗, ｗｉｄｅ, ᴄᴀᴘs, Ⓑⓤⓑⓑⓛⓔ and more letter styles.",
        authors: [{ name: "Deltacord" }],
    },
    start() {
        undo = registerCommands([{
            name: "fancy",
            description: "Write text in a fancy letter style",
            options: [
                { name: "text", displayName: "text", description: "The text", type: STRING, required: true },
                {
                    name: "style",
                    displayName: "style",
                    description: `Style: ${Object.keys(STYLES).join(", ")} (default script)`,
                    type: STRING,
                    choices: Object.entries(STYLES).map(([value, s]) => ({ name: value, displayName: s.label, value })),
                },
                { name: "only_me", displayName: "only_me", description: "Preview it only for you", type: BOOLEAN },
            ],
            execute(args: any[], ctx: any) {
                const requested = String(option(args, "style") ?? "script").toLowerCase().replace(/[^a-z]/g, "");
                const style = STYLES[requested] ?? STYLES.script;
                const content = style.apply(String(option(args, "text") ?? ""));
                if (option(args, "only_me")) return void reply(ctx.channel.id, content);
                return { content };
            },
        }]);
    },
    stop() {
        undo?.();
        undo = undefined;
    },
} as any);
