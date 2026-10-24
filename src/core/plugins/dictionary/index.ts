/**
 * Dictionary: /define looks up an English word (meanings, part of speech, an example), shown
 * only to you. Uses the free dictionaryapi.dev.
 */
import { defineCorePlugin } from "..";
import { option, registerCommands, reply } from "../shared";

const STRING = 3;
let undo: (() => void) | undefined;

export function formatDefinition(entries: any[]): string {
    const entry = entries?.[0];
    if (!entry) return "No definition found.";
    const lines = [`**${entry.word}**${entry.phonetic ? ` ${entry.phonetic}` : ""}`];
    for (const meaning of (entry.meanings ?? []).slice(0, 3)) {
        lines.push(`*${meaning.partOfSpeech}*`);
        for (const [i, def] of (meaning.definitions ?? []).slice(0, 3).entries()) {
            lines.push(`${i + 1}. ${def.definition}${def.example ? `\n   > ${def.example}` : ""}`);
        }
        const synonyms = (meaning.synonyms ?? []).slice(0, 6);
        if (synonyms.length) lines.push(`Similar: ${synonyms.join(", ")}`);
    }
    return lines.join("\n");
}

export default defineCorePlugin({
    manifest: {
        id: "deltacord.dictionary",
        name: "Dictionary",
        version: "1.0.0",
        description: "/define looks up a word's meanings, shown only to you.",
        authors: [{ name: "Deltacord" }],
    },
    start() {
        undo = registerCommands([{
            name: "define",
            description: "Look up what a word means (only you see it)",
            options: [{ name: "word", displayName: "word", description: "The word", type: STRING, required: true }],
            async execute(args: any[], ctx: any) {
                const word = String(option(args, "word") ?? "").trim();
                try {
                    const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
                    if (res.status === 404) return void reply(ctx.channel.id, `No definition found for "${word}".`);
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    reply(ctx.channel.id, formatDefinition(await res.json()));
                } catch (e: any) {
                    reply(ctx.channel.id, `Couldn't look that up: ${e?.message ?? e}`);
                }
            },
        }]);
    },
    stop() {
        undo?.();
        undo = undefined;
    },
} as any);
