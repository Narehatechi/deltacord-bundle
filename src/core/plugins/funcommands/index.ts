/**
 * Fun Commands: /roll, /coinflip, /choose, /8ball, /determination, /mock, /uwu, /reverse, /clap.
 */
import { defineCorePlugin } from "..";
import { option, registerCommands, reply } from "../shared";

const STRING = 3, INTEGER = 4, BOOLEAN = 5;
const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];

const EIGHT_BALL = [
    "It is certain.", "Without a doubt.", "Yes, definitely.", "You may rely on it.", "Most likely.",
    "Outlook good.", "Signs point to yes.", "Reply hazy, try again.", "Ask again later.",
    "Better not tell you now.", "Cannot predict now.", "Don't count on it.", "My reply is no.",
    "My sources say no.", "Outlook not so good.", "Very doubtful.",
];

const DETERMINATION = [
    "* You are filled with DETERMINATION.",
    "* The shadow of the ruins looms above, filling you with DETERMINATION.",
    "* Knowing the mouse might one day leave its hole and get the cheese... It fills you with DETERMINATION.",
    "* The sound of rushing water fills you with DETERMINATION.",
    "* Seeing such a cute, tidy house in the Ruins gives you DETERMINATION.",
    "* The convenience of that lamp still fills you with DETERMINATION.",
    "* The power of fluffy boys shines within you.",
    "* (The darkness... it fills you with DETERMINATION.)",
    "* It's a beautiful day outside. Birds are singing, flowers are blooming...",
    "* You feel like you're going to have a bad time.",
];

export const mock = (text: string) => [...text].map((c, i) => (i % 2 ? c.toUpperCase() : c.toLowerCase())).join("");
export const uwu = (text: string) => text
    .replace(/[rl]/g, "w").replace(/[RL]/g, "W")
    .replace(/n([aeiou])/g, "ny$1").replace(/N([aeiou])/g, "Ny$1").replace(/N([AEIOU])/g, "NY$1")
    .replace(/ove/g, "uv")
    + " " + pick(["uwu", "owo", ">w<", "^w^", ":3", "x3"]);

const send = { name: "only_me", displayName: "only_me", description: "Show it only to you instead of sending it", type: BOOLEAN };
const out = (args: any[], channelId: string, content: string) => {
    if (option(args, "only_me")) return void reply(channelId, content);
    return { content };
};

let undo: (() => void) | undefined;

export default defineCorePlugin({
    manifest: {
        id: "deltacord.funcommands",
        name: "Fun Commands",
        version: "1.0.0",
        description: "/roll, /coinflip, /choose, /8ball, /determination, /mock, /uwu, /reverse and /clap.",
        authors: [{ name: "Deltacord" }],
    },
    start() {
        undo = registerCommands([
            {
                name: "roll",
                description: "Roll dice",
                options: [
                    { name: "sides", displayName: "sides", description: "Sides on each die (default 6)", type: INTEGER },
                    { name: "dice", displayName: "dice", description: "How many dice (default 1)", type: INTEGER },
                    send,
                ],
                execute(args: any[], ctx: any) {
                    const sides = Math.min(1000, Math.max(2, Number(option(args, "sides")) || 6));
                    const count = Math.min(20, Math.max(1, Number(option(args, "dice")) || 1));
                    const rolls = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * sides));
                    const total = rolls.reduce((a, b) => a + b, 0);
                    return out(args, ctx.channel.id, `🎲 ${count}d${sides}: ${rolls.join(", ")}${count > 1 ? ` (total ${total})` : ""}`);
                },
            },
            {
                name: "coinflip",
                description: "Flip a coin",
                options: [send],
                execute: (args: any[], ctx: any) => out(args, ctx.channel.id, `🪙 ${Math.random() < 0.5 ? "Heads" : "Tails"}!`),
            },
            {
                name: "choose",
                description: "Pick one for you",
                options: [{ name: "options", displayName: "options", description: "Choices, separated by commas", type: STRING, required: true }, send],
                execute(args: any[], ctx: any) {
                    const choices = String(option(args, "options") ?? "").split(",").map(s => s.trim()).filter(Boolean);
                    if (!choices.length) return void reply(ctx.channel.id, "Give me some choices, separated by commas.");
                    return out(args, ctx.channel.id, `🤔 I choose: **${pick(choices)}**`);
                },
            },
            {
                name: "8ball",
                description: "Ask the magic 8-ball",
                options: [{ name: "question", displayName: "question", description: "Your question", type: STRING, required: true }, send],
                execute: (args: any[], ctx: any) => out(args, ctx.channel.id, `> ${option(args, "question")}\n🎱 ${pick(EIGHT_BALL)}`),
            },
            {
                name: "determination",
                description: "* You are filled with DETERMINATION.",
                options: [send],
                execute: (args: any[], ctx: any) => out(args, ctx.channel.id, pick(DETERMINATION)),
            },
            ...([
                ["mock", "sPoNgEbOb TeXt", mock],
                ["uwu", "Uwuify text", uwu],
                ["reverse", "txet esreveR", (t: string) => [...t].reverse().join("")],
                ["clap", "Put 👏 between 👏 words", (t: string) => t.trim().split(/\s+/).join(" 👏 ")],
            ] as const).map(([name, description, fn]) => ({
                name,
                description,
                options: [{ name: "text", displayName: "text", description: "The text", type: STRING, required: true }, send],
                execute: (args: any[], ctx: any) => out(args, ctx.channel.id, fn(String(option(args, "text") ?? ""))),
            })),
        ]);
    },
    stop() {
        undo?.();
        undo = undefined;
    },
} as any);
