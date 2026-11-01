/**
 * Translate: /translate sends your text in another language; /translate-preview shows a
 * translation only to you (paste a message you got into it to read it).
 * Uses Google Translate's free web endpoint, falling back to Lingva. Links, mentions, emoji and code
 * are left untouched, and long text is translated in parts.
 */
import { defineCorePlugin } from "..";
import { option, registerCommands, reply } from "../shared";
import { languageCode, nameOf, translate } from "./engine";

const STRING = 3;

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
