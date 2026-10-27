/**
 * Typewriter: new messages in the chat you're looking at type themselves out letter by letter,
 * like Deltarune's dialogue, with a text sound for each letter and little pauses after
 * punctuation. Tap-free: it just plays as messages arrive.
 *
 * How: Discord draws each chat row in RowManager.generate. While a message is "typing", its row
 * is drawn with only the letters revealed so far, and a ticker asks Discord to redraw the row as
 * more letters appear (flipping an unused message flag, which Discord treats as a change).
 *
 * The sound is Deltacord's own blip by default; you can use any short sound by link (it's
 * downloaded once and kept on the phone).
 */
import { createMMKVBackend, createStorage, useProxy, wrapSync } from "@core/vendetta/storage";
import { intercept } from "@lib/api/flux";
import { after, before } from "@lib/api/patcher";
import { showToast } from "@lib/ui/toasts";
import { FluxDispatcher, ReactNative } from "@metro/common";
import { AlertActionButton, AlertActions, AlertModal, Button, Stack, TableRow, TableRowGroup, TableSwitchRow, Text, TextInput } from "@metro/common/components";
import { openAlert } from "@lib/ui/alerts";
import { findByName, findByProps, findByStoreNameLazy } from "@metro/wrappers";
import { useState } from "react";
import { processColor, ScrollView } from "react-native";

import { defineCorePlugin } from "..";
import { all, option, registerCommands, reply } from "../shared";

const MessageStore = findByStoreNameLazy("MessageStore");
const UserStore = findByStoreNameLazy("UserStore");
const SelectedChannelStore = findByStoreNameLazy("SelectedChannelStore");

interface TypewriterSettings {
    speed?: "slow" | "normal" | "fast";
    sound?: boolean;
    /** Your own messages type out too. */
    own?: boolean;
    /** "* " before messages, like in-game dialogue. */
    asterisk?: boolean;
    /** A quick flash on a message as its text box opens. */
    flash?: boolean;
    /** How much each letter's sound varies in pitch. */
    wobble?: "off" | "subtle" | "strong";
    soundUrl?: string | null;
    soundFile?: string | null;
    /** The imported file's name (for the settings). */
    soundName?: string | null;
    /** Each person's own voice: a sound and/or a pitch, by user id. */
    voices?: Record<string, Voice>;
}

export interface Voice {
    /** Their name when the voice was set (for the settings list). */
    name: string;
    soundUrl?: string | null;
    soundFile?: string | null;
    soundName?: string | null;
    /** 0.5 (low) to 2 (high); 1 is normal. */
    pitch?: number;
}
const store = wrapSync(createStorage<TypewriterSettings>(createMMKVBackend("DELTACORD_TYPEWRITER")));

/** The game runs at 30 frames a second; text moves in whole frames. */
const FRAME = 1000 / 30;
/** Frames per letter: normal is one letter a frame, like the game. */
const SPEEDS = { slow: 2, normal: 1, fast: 0.5 } as const;
/** Long messages finish within this, however long they are. */
const MAX_DURATION = 5000;
const REDRAW_FLAG = 0x10000000;
const TICK = Math.round(FRAME);
/** A short beat before a message starts typing, like a text box opening. */
const OPEN_DELAY = 150;
/** How long the opening flash lasts. */
const FLASH_MS = 350;
/** Marks the "* " Deltacord adds, so it's never added twice. */
const STAR = "__deltacordStar";
/** At most one sound this often (ms): about every frame, like the game's text voice. */
const SOUND_GAP = 30;
/** Pitch wobble per letter: how far (as a fraction) each letter's pitch can stray. */
const WOBBLE = { off: 0, subtle: 0.05, strong: 0.14 } as const;
const PITCH_STEP = 0.15;

interface Typing {
    /** Your own sent messages: the temporary id Discord used before the server's copy arrived. */
    nonce?: string;
    /** The text being typed (kept here: the message can change ids or leave the store mid-type). */
    text: string;
    channelId: string;
    authorId?: string;
    guildId?: string;
    /** When it started typing; null while it waits its turn. */
    start: number | null;
    /** When each character of the text appears (ms after start). */
    times: number[];
    revealed: number;
}

const typing = new Map<string, Typing>();
let ticker: ReturnType<typeof setInterval> | undefined;
let lastSound = 0;

/**
 * When each character appears, in frames like the game: one letter a frame at normal speed, a
 * short pause after commas, a longer one after . ! ? (each dot of "..." pauses), and after line
 * breaks. No pause at the very end. Long messages are squeezed to finish in time.
 */
export function schedule(text: string, framesPerLetter: number): number[] {
    const times: number[] = [];
    let frames = 0;
    for (let i = 0; i < text.length; i++) {
        times.push(Math.round(frames * FRAME));
        const c = text[i];
        const next = text[i + 1];
        const last = i === text.length - 1;
        if (last) break;
        let wait = framesPerLetter;
        // Pauses only where a sentence actually breaks (not "3.14" or "a.b").
        const breaks = next === undefined || next === " " || next === "\n" || ".!?,".includes(next);
        if ((c === "." || c === "!" || c === "?") && breaks) wait = 10;
        else if ((c === "," || c === ";" || c === ":") && breaks) wait = 5;
        else if (c === "\n") wait = 8;
        frames += wait;
    }
    const total = times[times.length - 1] ?? 0;
    if (total > MAX_DURATION) return times.map(x => Math.round((x * MAX_DURATION) / total));
    return times;
}

/** Letters that make the text voice (spaces and punctuation are silent, like the game). */
export const voiced = (c: string) => /[A-Za-z0-9]/.test(c) || (c.charCodeAt(0) > 127 && !/\s/.test(c));

/** How many of the text's characters show at this moment. */
export const revealedAt = (times: number[], elapsed: number) => {
    let n = 0;
    while (n < times.length && times[n] <= elapsed) n++;
    return n;
};

/** Counts the characters in Discord's parsed message nodes (emoji, mentions etc. count as 1). */
function countNodes(nodes: any[]): number {
    let n = 0;
    for (const node of nodes) {
        if (typeof node === "string") n += node.length;
        else if (typeof node?.content === "string") n += node.content.length;
        else if (Array.isArray(node?.content)) n += countNodes(node.content);
        else n += 1;
    }
    return n;
}

/** Parsed message nodes split after `count` characters: [shown, still to come]. */
export function splitNodes(nodes: any[], count: number): [any[], any[]] {
    const head: any[] = [];
    const tail: any[] = [];
    let left = count;
    for (const node of nodes) {
        if (left <= 0) {
            tail.push(node);
            continue;
        }
        if (typeof node === "string") {
            head.push(node.slice(0, left));
            if (node.length > left) tail.push(node.slice(left));
            left -= Math.min(left, node.length);
        } else if (typeof node?.content === "string") {
            head.push({ ...node, content: node.content.slice(0, left) });
            if (node.content.length > left) tail.push({ ...node, content: node.content.slice(left) });
            left -= Math.min(left, node.content.length);
        } else if (Array.isArray(node?.content)) {
            const innerCount = countNodes(node.content);
            if (innerCount <= left) {
                head.push(node);
                left -= innerCount;
            } else {
                const [a, b] = splitNodes(node.content, left);
                head.push({ ...node, content: a });
                tail.push({ ...node, content: b });
                left = 0;
            }
        } else {
            head.push(node);
            left -= 1;
        }
    }
    return [head, tail];
}

const INLINE = new Set(["text", "strong", "em", "u", "s", "inlineCode", "link", "spoiler", "mention", "channel"]);

/** Wraps nodes in a see-through link node: they still take up their space, so nothing jumps. */
function invisible(nodes: any[]): any[] {
    const clear = processColor("#00000000") as unknown as number;
    const out: any[] = [];
    let run: any[] = [];
    const flush = () => {
        if (!run.length) return;
        out.push({
            type: "link",
            target: "usernameOnClick",
            context: { username: "", usernameOnClick: { action: "0", userId: "0", linkColor: clear, messageChannelId: "0" } },
            content: run,
        });
        run = [];
    };
    for (const node of nodes) {
        if (typeof node === "string") run.push({ type: "text", content: node });
        else if (node && INLINE.has(node.type)) run.push(node);
        else {
            // Emoji and other pictures can't be made see-through; they appear with their turn.
            flush();
        }
    }
    flush();
    return out;
}

/** The first `count` characters of parsed message nodes. */
export function truncateNodes(nodes: any[], count: number): [any[], number] {
    const out: any[] = [];
    let left = count;
    for (const node of nodes) {
        if (left <= 0) break;
        if (typeof node === "string") {
            out.push(node.slice(0, left));
            left -= Math.min(left, node.length);
        } else if (typeof node?.content === "string") {
            out.push({ ...node, content: node.content.slice(0, left) });
            left -= Math.min(left, node.content.length);
        } else if (Array.isArray(node?.content)) {
            const [inner, remaining] = truncateNodes(node.content, left);
            out.push({ ...node, content: inner });
            left = remaining;
        } else {
            out.push(node);
            left -= 1;
        }
    }
    return [out, left];
}

function redraw(channelId: string, id: string, guildId?: string) {
    const record = MessageStore.getMessage?.(channelId, id);
    if (!record) return;
    try {
        FluxDispatcher.dispatch({
            type: "MESSAGE_UPDATE",
            guildId,
            message: { id, channel_id: channelId, guild_id: guildId, flags: (record.flags | 0) ^ REDRAW_FLAG },
        });
    } catch { }
}

/** The voice for a person: theirs if you set one, otherwise the default. */
export function voiceFor(userId?: string): { source?: string; pitch: number; } {
    const voice = userId ? store.voices?.[userId] : undefined;
    return {
        source: voice?.soundFile ?? voice?.soundUrl ?? voiceSource(),
        pitch: Math.min(2, Math.max(0.5, voice?.pitch ?? 1)),
    };
}

function playVoice(userId?: string) {
    if (store.sound === false) return;
    const now = Date.now();
    if (now - lastSound < SOUND_GAP) return;
    lastSound = now;
    try {
        const { source, pitch } = voiceFor(userId);
        // A little random pitch on each letter, so it sounds spoken rather than stamped.
        const amount = WOBBLE[store.wobble ?? "subtle"] ?? 0;
        const rate = Math.min(2, Math.max(0.5, pitch * (1 + (Math.random() * 2 - 1) * amount)));
        if (source) void require("@core/deltacord/extras").playSoundSource(source, 1, rate);
    } catch { }
}

/** Sets (or changes) a person's voice. A link is downloaded once and kept on the phone. */
async function setVoice(userId: string, name: string, link?: string, pitch?: number, picked?: { file: string; name: string; } | null) {
    const voices = { ...(store.voices ?? {}) };
    const voice: Voice = { ...(voices[userId] ?? {}), name };
    if (picked) {
        const extras = require("@core/deltacord/extras");
        extras.removeSoundFile(voice.soundFile);
        voice.soundFile = picked.file;
        voice.soundName = picked.name;
        voice.soundUrl = null;
        extras.preloadSound(picked.file);
    } else if (link?.trim()) {
        const extras = require("@core/deltacord/extras");
        const file = await extras.downloadSound(link, `voice-${userId}`);
        extras.removeSoundFile(voice.soundFile);
        voice.soundFile = file;
        voice.soundUrl = link.trim();
        voice.soundName = null;
        extras.preloadSound(file);
    }
    if (pitch != null && isFinite(pitch)) voice.pitch = Math.min(2, Math.max(0.5, pitch));
    voices[userId] = voice;
    store.voices = voices;
    return voice;
}

function removeVoice(userId: string) {
    const voices = { ...(store.voices ?? {}) };
    const voice = voices[userId];
    if (!voice) return false;
    require("@core/deltacord/extras").removeSoundFile(voice.soundFile);
    delete voices[userId];
    store.voices = voices;
    return true;
}

const describeVoice = (v: Voice) =>
    `${v.soundName ? `sound "${v.soundName}"` : v.soundUrl ? "own sound" : "default sound"}${v.pitch && v.pitch !== 1 ? `, pitch ${v.pitch}` : ""}`;

function tick() {
    const now = Date.now();
    // One message types at a time, like dialogue: the next waits for the one before it.
    let active: [string, Typing] | undefined;
    for (const entry of typing) {
        if (entry[1].start !== null) {
            active = entry;
            break;
        }
    }
    if (!active) {
        const next = typing.entries().next().value as [string, Typing] | undefined;
        if (next) {
            // A backlog speeds up so it never falls far behind the chat.
            const backlog = typing.size - 1;
            if (backlog >= 2) next[1].times = next[1].times.map(x => x / Math.min(4, backlog));
            next[1].start = now + OPEN_DELAY;
            active = next;
        }
    }
    if (active) {
        const [id, t] = active;
        const text = t.text;
        const n = revealedAt(t.times, now - (t.start ?? now));
        const flashing = store.flash !== false && t.start !== null && now >= t.start && now - t.start < FLASH_MS + TICK;
        if (n === t.revealed && flashing) redraw(t.channelId, id, t.guildId);
        if (n !== t.revealed) {
            // A new letter: its voice (spaces and punctuation stay silent).
            if ([...text.slice(t.revealed, n)].some(voiced)) playVoice(t.authorId);
            t.revealed = n;
            if (n >= t.times.length) typing.delete(id);
            redraw(t.channelId, id, t.guildId);
        }
    }
    if (!typing.size && ticker) {
        clearInterval(ticker);
        ticker = undefined;
    }
}

/** Shows everything still typing straight away (like pressing the button to skip the text). */
function finishAll() {
    for (const [id, t] of typing) {
        typing.delete(id);
        redraw(t.channelId, id, t.guildId);
    }
}

/** A message got a new id (your sent message, once the server has it): keep its progress. */
function moveTyping(nonce: string, id: string): boolean {
    if (nonce === id) return typing.has(id);
    for (const [oldId, t] of typing) {
        if (t.nonce !== nonce && oldId !== nonce) continue;
        // Re-key, keeping its place in the queue.
        const entries = [...typing.entries()].map(([k, v]) => (k === oldId ? [id, v] : [k, v]) as [string, Typing]);
        typing.clear();
        for (const [k, v] of entries) typing.set(k, v);
        typedIds.add(id);
        redraw(t.channelId, id, t.guildId);
        return true;
    }
    return false;
}

/** Messages already typed (or typing), so the same message never types twice. */
const typedIds = new Set<string>();
/** Recent messages by channel + author + text: catches the same message arriving again under a new id. */
const recent = new Map<string, { id: string; at: number; }>();
const RECENT_MS = 20_000;

function remember(id: string, key: string) {
    typedIds.add(id);
    if (typedIds.size > 500) typedIds.delete(typedIds.values().next().value!);
    recent.set(key, { id, at: Date.now() });
    for (const [k, v] of recent) if (Date.now() - v.at > RECENT_MS) recent.delete(k);
}

function startTyping(message: any, guildId?: string) {
    const text = typeof message?.content === "string" ? message.content : "";
    if (!message?.id || !text.trim()) return;
    // Already typed or typing: don't start it over (that was the "stops and repeats").
    if (typing.has(message.id) || typedIds.has(message.id)) return;
    const key = `${message.channel_id}:${message.author?.id}:${text}`;
    const seen = recent.get(key);
    if (seen && Date.now() - seen.at < RECENT_MS) {
        // The same message again with a new id (your sent message, or Discord resending it):
        // carry on with the one already typing, or leave it be if it's done.
        moveTyping(seen.id, message.id);
        remember(message.id, key);
        return;
    }
    if (!require("@core/deltacord/extras").appOnScreen()) return;
    remember(message.id, key);
    typing.set(message.id, {
        nonce: message.nonce,
        text,
        channelId: message.channel_id,
        authorId: message.author?.id,
        guildId,
        start: null,
        times: schedule(text, SPEEDS[store.speed ?? "normal"] ?? SPEEDS.normal),
        revealed: 0,
    });
    ticker ??= setInterval(tick, TICK);
}

function voiceSource(): string | undefined {
    try {
        return store.soundFile ?? store.soundUrl ?? require("@core/deltacord/extras").builtinSound("blip.wav");
    } catch {
        return undefined;
    }
}

/** While a message is typing, its row shows only the letters revealed so far. */
function patchRows() {
    let RowManager = findByName("RowManager");
    if (!RowManager?.prototype?.generate) RowManager = findByName("RowManager", false)?.default;
    if (!RowManager?.prototype?.generate) {
        console.error("[Typewriter] Couldn't find Discord's chat rows");
        return () => { };
    }
    return after("generate", RowManager.prototype, ([input]: any[], row: any) => {
        try {
            if ((input?.rowType ?? row?.rowType) !== 1) return;
            const message = row?.message;
            if (!message?.id || !Array.isArray(message.content)) return;
            // Drop our own "* " if the row is being rebuilt from what we drew last time.
            let content: any[] = message.content.filter((n: any) => !n?.[STAR]);
            const star = store.asterisk !== false && content.length
                ? [{ type: "text", content: "* ", [STAR]: true }]
                : [];

            const t = typing.get(message.id);
            if (t) {
                const fraction = t.times.length ? t.revealed / t.times.length : 1;
                const total = countNodes(content);
                // The letters still to come are drawn see-through, so the message keeps its full
                // size from the start and the chat doesn't jump around as it types.
                const [shown, rest] = splitNodes(content, Math.max(0, Math.round(total * fraction)));
                content = [...shown, ...invisible(rest)];

                // The text box opening: a white flash on the message that fades out.
                const since = t.start === null ? -1 : Date.now() - t.start;
                if (store.flash !== false && since >= 0 && since < FLASH_MS) {
                    const alpha = Math.round(0x40 * (1 - since / FLASH_MS)).toString(16).padStart(2, "0");
                    row.backgroundHighlight = {
                        backgroundColor: processColor(`#FFFFFF${alpha}`),
                        gutterColor: processColor("#FFFFFF"),
                    };
                }
            }
            message.content = [...star, ...content];
        } catch { }
    });
}

/**
 * A person's voice, in one place: hear it, import a sound file, make it higher or lower, or
 * reset it. Opened from Typewriter's settings and from long-pressing their message.
 */
export function openVoiceEditor(userId: string, name: string) {
    const voice = store.voices?.[userId];
    const pitch = voice?.pitch ?? 1;
    const changePitch = async (by: number) => {
        const next = Math.round(Math.min(2, Math.max(0.5, pitch + by)) * 100) / 100;
        await setVoice(userId, name, undefined, next);
        lastSound = 0;
        playVoice(userId);
        openVoiceEditor(userId, name);
    };
    lastSound = 0;
    playVoice(userId);
    openAlert("deltacord-typewriter-voice", <AlertModal
        title={userId === UserStore.getCurrentUser?.()?.id ? "Your voice" : `${name}'s voice`}
        content={voice ? `${describeVoice(voice)}.` : "Using the default voice. Import a sound or change the pitch to give them their own."}
        actions={<AlertActions>
            <AlertActionButton text="Import a sound file" variant="primary" onPress={async () => {
                try {
                    const picked = await require("@core/deltacord/extras").pickSound();
                    if (!picked) return;
                    await setVoice(userId, name, undefined, undefined, picked);
                    lastSound = 0;
                    playVoice(userId);
                    showToast(`${name}: ${picked.name}`);
                } catch (e: any) {
                    showToast(e?.message ?? String(e));
                }
            }} />
            <AlertActionButton text={`Higher (now ${pitch})`} variant="secondary" onPress={() => void changePitch(PITCH_STEP)} />
            <AlertActionButton text={`Lower (now ${pitch})`} variant="secondary" onPress={() => void changePitch(-PITCH_STEP)} />
            <AlertActionButton text="Play" variant="secondary" onPress={() => {
                lastSound = 0;
                playVoice(userId);
                openVoiceEditor(userId, name);
            }} />
            {voice ? <AlertActionButton text="Back to the default voice" variant="destructive" onPress={() => {
                removeVoice(userId);
                showToast(`${name} uses the default voice`);
            }} /> : null}
            <AlertActionButton text="Close" variant="secondary" />
        </AlertActions>}
    />);
}

/**
 * Adds "Typewriter voice" to the menu you get by long-pressing a message, for its author.
 * Discord loads that menu on demand (openLazy); its rows are copied from one already there.
 */
function patchMessageMenu(): () => void {
    const sheets = findByProps("openLazy", "hideActionSheet");
    if (typeof sheets?.openLazy !== "function") {
        console.error("[Typewriter] Couldn't find Discord's menus");
        return () => { };
    }
    const React = require("react");
    const isRow = (node: any) => !!node?.props && typeof node.props.label === "string" && typeof node.props.onPress === "function";
    const KEY = "deltacord-typewriter-voice";

    const addRow = (tree: any, author: any) => {
        let done = false;
        const visit = (node: any, depth: number): any => {
            if (done || !node || typeof node !== "object" || depth > 30) return node;
            if (Array.isArray(node)) {
                const rows = node.filter(isRow);
                if (rows.length) {
                    if (node.some((n: any) => n?.key === KEY)) {
                        done = true;
                        return node;
                    }
                    done = true;
                    const mine = author.id === UserStore.getCurrentUser?.()?.id;
                    const name = author.globalName ?? author.global_name ?? author.username ?? "them";
                    const row = React.cloneElement(rows[0], {
                        key: KEY,
                        label: mine ? "Your Typewriter voice" : `Typewriter voice for ${name}`,
                        onPress: () => {
                            try {
                                sheets.hideActionSheet?.();
                            } catch { }
                            setTimeout(() => openVoiceEditor(author.id, name), 250);
                        },
                    });
                    return [...node, row];
                }
                let changed = false;
                const next = node.map(child => {
                    const out = visit(child, depth + 1);
                    if (out !== child) changed = true;
                    return out;
                });
                return changed ? next : node;
            }
            if (node.props) {
                for (const prop of ["children", "items"]) {
                    const child = node.props[prop];
                    if (!child || typeof child !== "object") continue;
                    const out = visit(child, depth + 1);
                    if (out !== child) return React.cloneElement(node, { [prop]: out });
                }
            }
            return node;
        };
        return visit(tree, 0);
    };

    let undoMenu: (() => unknown) | undefined;
    let menuTimer: ReturnType<typeof setTimeout> | undefined;
    const dropMenuPatch = () => {
        undoMenu?.();
        undoMenu = undefined;
        if (menuTimer) clearTimeout(menuTimer);
    };

    const unpatch = before("openLazy", sheets, (args: any[]) => {
        try {
            dropMenuPatch();
            const [component, key, context] = args;
            const author = context?.message?.author;
            if (key !== "MessageLongPressActionSheet" || !author?.id || typeof component?.then !== "function") return;
            component.then((module: any) => {
                if (!module || typeof module.default !== "function") return;
                // Kept while this menu is open (it can redraw); removed when the next menu opens.
                undoMenu = after("default", module, (_: any, tree: any) => {
                    try {
                        return addRow(tree, author);
                    } catch {
                        return tree;
                    }
                });
                menuTimer = setTimeout(dropMenuPatch, 60_000);
            });
        } catch { }
    });
    return () => {
        unpatch();
        dropMenuPatch();
    };
}

function TypewriterSettingsPage() {
    useProxy(store);
    const [link, setLink] = useState("");
    const [busy, setBusy] = useState(false);
    const speed = store.speed ?? "normal";
    const speeds: Array<keyof typeof SPEEDS> = ["slow", "normal", "fast"];
    return (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 38 }}>
            <Stack style={{ paddingVertical: 24, paddingHorizontal: 12 }} spacing={16}>
                <TableRowGroup title="Typing">
                    <TableRow
                        label="Speed"
                        subLabel="Tap to change."
                        trailing={<TableRow.TrailingText text={speed[0].toUpperCase() + speed.slice(1)} />}
                        onPress={() => void (store.speed = speeds[(speeds.indexOf(speed) + 1) % speeds.length])}
                    />
                    <TableSwitchRow label="My own messages too" subLabel="Your messages type out in your voice (long-press one of yours to set it)." value={store.own !== false} onValueChange={(v: boolean) => void (store.own = v)} />
                </TableRowGroup>
                <TableRowGroup title="Voice feel">
                    <TableRow
                        label="Pitch wobble"
                        subLabel="Each letter's sound varies a little in pitch, so it sounds spoken. Works on imported sounds too. Tap to change."
                        trailing={<TableRow.TrailingText text={(store.wobble ?? "subtle").replace(/^./, c => c.toUpperCase())} />}
                        onPress={() => {
                            const order: Array<keyof typeof WOBBLE> = ["off", "subtle", "strong"];
                            store.wobble = order[(order.indexOf(store.wobble ?? "subtle") + 1) % order.length];
                            lastSound = 0;
                            playVoice();
                        }}
                    />
                </TableRowGroup>
                <TableRowGroup title="Look">
                    <TableSwitchRow
                        label="* before messages"
                        subLabel={'Every message starts with "* ", like dialogue in the game.'}
                        value={store.asterisk !== false}
                        onValueChange={(v: boolean) => {
                            store.asterisk = v;
                            require("@core/deltacord/refresh").refreshChat();
                        }}
                    />
                    <TableSwitchRow
                        label="Flash when a message starts"
                        subLabel="A quick white flash as each message's text box opens."
                        value={store.flash !== false}
                        onValueChange={(v: boolean) => void (store.flash = v)}
                    />
                </TableRowGroup>
                <TableRowGroup title="Text sound">
                    <TableSwitchRow label="Play a sound while typing" value={store.sound !== false} onValueChange={(v: boolean) => void (store.sound = v)} />
                    <TableRow label="Sound" subLabel={store.soundName ?? store.soundUrl ?? "Deltacord's blip"} />
                    <TableRow label="Test the sound" onPress={() => {
                        lastSound = 0;
                        playVoice();
                    }} />
                </TableRowGroup>
                <Button
                    text={busy ? "Working…" : "Import a sound file"}
                    disabled={busy}
                    onPress={async () => {
                        setBusy(true);
                        try {
                            const extras = require("@core/deltacord/extras");
                            const picked = await extras.pickSound();
                            if (picked) {
                                extras.removeSoundFile(store.soundFile);
                                store.soundFile = picked.file;
                                store.soundName = picked.name;
                                store.soundUrl = null;
                                lastSound = 0;
                                playVoice();
                                showToast(`Text sound: ${picked.name}`);
                            }
                        } catch (e: any) {
                            showToast(e?.message ?? String(e));
                        } finally {
                            setBusy(false);
                        }
                    }}
                />
                <TextInput label="Or use a link" value={link} placeholder="https://…" onChange={setLink} />
                {link.trim() ? (
                    <Button
                        text={busy ? "Downloading…" : "Use this link"}
                        variant="secondary"
                        disabled={busy}
                        onPress={async () => {
                            setBusy(true);
                            try {
                                const extras = require("@core/deltacord/extras");
                                const file = await extras.downloadSound(link, "voice");
                                extras.removeSoundFile(store.soundFile);
                                store.soundFile = file;
                                store.soundUrl = link.trim();
                                store.soundName = null;
                                setLink("");
                                lastSound = 0;
                                playVoice();
                                showToast("Text sound saved");
                            } catch (e: any) {
                                showToast(e?.message ?? String(e));
                            } finally {
                                setBusy(false);
                            }
                        }}
                    />
                ) : null}
                {store.soundFile || store.soundUrl ? (
                    <Button text="Back to Deltacord's blip" variant="secondary" onPress={() => {
                        require("@core/deltacord/extras").removeSoundFile(store.soundFile);
                        store.soundFile = null;
                        store.soundUrl = null;
                        store.soundName = null;
                    }} />
                ) : null}
                <TableRowGroup title={`Voices for people (${Object.keys(store.voices ?? {}).length})`}>
                    {Object.keys(store.voices ?? {}).length
                        ? Object.entries(store.voices ?? {}).map(([id, v]) => (
                            <TableRow
                                key={id}
                                label={UserStore.getUser?.(id)?.globalName ?? UserStore.getUser?.(id)?.username ?? v.name}
                                subLabel={`${describeVoice(v)} · tap for options`}
                                onPress={() => openVoiceEditor(id, v.name)}
                            />
                        ))
                        : <TableRow label="Nobody yet" subLabel="In any chat, type /voice, pick a person, and add a sound link and/or a pitch." />}
                </TableRowGroup>
                <Text variant="text-xs/medium" color="text-muted">
                    Give someone their own voice with /voice: a sound (link) and/or a pitch from 0.5 (low) to 2 (high). /voice-remove takes it away, /voices lists them.
                </Text>
                <Text variant="text-xs/medium" color="text-muted">
                    Only new messages in the chat you're looking at type out, one at a time like dialogue. Start typing, send something or switch chats to skip to the end, like pressing the button in the game. The sound is downloaded once and kept on your phone, so a Discord attachment link works even after it expires.
                </Text>
            </Stack>
        </ScrollView>
    );
}

let undo: (() => void) | undefined;

export default defineCorePlugin({
    manifest: {
        id: "deltacord.typewriter",
        name: "Typewriter",
        version: "1.0.0",
        description: "New messages type themselves out letter by letter like Deltarune's dialogue, with a text sound.",
        authors: [{ name: "Deltacord" }],
    },
    start() {
        // Load the text sound now, so the first letter isn't silent.
        const source = voiceSource();
        if (source) require("@core/deltacord/extras").preloadSound(source);
        undo = all(
            patchRows(),
            patchMessageMenu(),
            // Leaving Discord (home screen, another app, screen off): finish everything silently,
            // so nothing is left mid-type or making sound in the background.
            (() => {
                const sub = (require("react-native").AppState ?? ReactNative?.AppState)?.addEventListener?.("change", (state: string) => {
                    if (state !== "active" && typing.size) finishAll();
                });
                return () => sub?.remove?.();
            })(),
            registerCommands([
                {
                    name: "voice",
                    description: "Give someone their own Typewriter voice (only you hear it)",
                    options: [
                        { name: "user", displayName: "user", description: "Who", type: 6, required: true },
                        { name: "file", displayName: "file", description: "Pick a sound file from your phone", type: 5 },
                        { name: "sound", displayName: "sound", description: "Or a link to a short WAV, MP3 or OGG", type: 3 },
                        { name: "pitch", displayName: "pitch", description: "0.5 (low) to 2 (high), 1 is normal (optional)", type: 10 },
                    ],
                    async execute(args: any[], ctx: any) {
                        const userId = String(option(args, "user") ?? "");
                        const link = option(args, "sound");
                        const pitchRaw = option(args, "pitch");
                        const pitch = pitchRaw == null ? undefined : Number(pitchRaw);
                        if (!userId) return void reply(ctx.channel.id, "Pick someone.");
                        const wantsFile = option(args, "file") === true;
                        if (!wantsFile && !link && pitch == null) return void reply(ctx.channel.id, "Pick a sound file, add a link, or set a pitch.");
                        const user = UserStore.getUser?.(userId);
                        const name = user?.globalName ?? user?.username ?? "them";
                        try {
                            const picked = wantsFile ? await require("@core/deltacord/extras").pickSound() : null;
                            if (wantsFile && !picked && pitch == null) return void reply(ctx.channel.id, "No file picked, so nothing changed.");
                            const voice = await setVoice(userId, name, link, pitch, picked);
                            reply(ctx.channel.id, `\u{1F50A} ${name} now sounds like: ${describeVoice(voice)}.`);
                            lastSound = 0;
                            playVoice(userId);
                        } catch (e: any) {
                            reply(ctx.channel.id, `Couldn't set that voice: ${e?.message ?? e}`);
                        }
                    },
                },
                {
                    name: "voice-remove",
                    description: "Put someone back on the default Typewriter voice",
                    options: [{ name: "user", displayName: "user", description: "Who", type: 6, required: true }],
                    execute(args: any[], ctx: any) {
                        const userId = String(option(args, "user") ?? "");
                        reply(ctx.channel.id, removeVoice(userId) ? "Back to the default voice." : "They didn't have their own voice.");
                    },
                },
                {
                    name: "voices",
                    description: "List everyone's Typewriter voices",
                    options: [],
                    execute(_args: any[], ctx: any) {
                        const entries = Object.entries(store.voices ?? {});
                        reply(ctx.channel.id, entries.length
                            ? `**Typewriter voices (${entries.length})**\n${entries.map(([id, v]) => `• ${UserStore.getUser?.(id)?.globalName ?? v.name}: ${describeVoice(v)}`).join("\n")}`
                            : "Nobody has their own voice yet. Add one with /voice.");
                    },
                },
            ]),
            intercept(payload => {
                try {
                    // You start typing, send, or switch chats: everything finishes at once (like skipping text in the game).
                    if (payload.type === "TYPING_START_LOCAL") {
                        if (typing.size) finishAll();
                        return undefined;
                    }
                    // Only a real switch to another chat (Discord also re-sends the current one).
                    if (payload.type === "CHANNEL_SELECT") {
                        const leaving = [...typing.values()].some(t => t.channelId !== payload.channelId);
                        if (leaving) finishAll();
                        return undefined;
                    }
                    if (payload.type !== "MESSAGE_CREATE") return undefined;
                    const message = payload.message;
                    if (!message || message.channel_id !== SelectedChannelStore.getChannelId?.()) return undefined;
                    const mine = message.author?.id === UserStore.getCurrentUser?.()?.id;

                    // Your own message going out: Discord shows it straight away (optimistic), then
                    // swaps in the server's copy with a new id. Anything still typing finishes, and
                    // your message types out in your voice from the moment it appears.
                    if (payload.optimistic || (mine && message.state === "SENDING")) {
                        if (typing.size) finishAll();
                        if (store.own !== false) startTyping(message, payload.guildId ?? message.guild_id);
                        return undefined;
                    }
                    // The server's copy of a message already typing: carry on where it was.
                    if (message.nonce && moveTyping(message.nonce, message.id)) return undefined;

                    if (mine && store.own === false) return undefined;
                    startTyping(message, payload.guildId ?? message.guild_id);
                } catch { }
                return undefined;
            }),
            () => {
                if (ticker) clearInterval(ticker);
                ticker = undefined;
                // Finish anything mid-type so nothing stays cut off.
                for (const [id, t] of typing) {
                    typing.delete(id);
                    redraw(t.channelId, id, t.guildId);
                }
            },
        );
    },
    stop() {
        undo?.();
        undo = undefined;
    },
    SettingsComponent: TypewriterSettingsPage,
} as any);
