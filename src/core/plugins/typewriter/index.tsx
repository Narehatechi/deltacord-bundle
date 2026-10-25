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
import { after } from "@lib/api/patcher";
import { showToast } from "@lib/ui/toasts";
import { FluxDispatcher } from "@metro/common";
import { Button, Stack, TableRow, TableRowGroup, TableSwitchRow, Text, TextInput } from "@metro/common/components";
import { findByName, findByStoreNameLazy } from "@metro/wrappers";
import { useState } from "react";
import { processColor, ScrollView } from "react-native";

import { defineCorePlugin } from "..";
import { all } from "../shared";

const MessageStore = findByStoreNameLazy("MessageStore");
const UserStore = findByStoreNameLazy("UserStore");
const SelectedChannelStore = findByStoreNameLazy("SelectedChannelStore");

interface TypewriterSettings {
    speed?: "slow" | "normal" | "fast";
    sound?: boolean;
    /** Your own messages type out too. */
    own?: boolean;
    soundUrl?: string | null;
    soundFile?: string | null;
}
const store = wrapSync(createStorage<TypewriterSettings>(createMMKVBackend("DELTACORD_TYPEWRITER")));

const SPEEDS = { slow: 60, normal: 34, fast: 18 } as const;
/** Long messages finish within this, however long they are. */
const MAX_DURATION = 4500;
const REDRAW_FLAG = 0x10000000;
const TICK = 33;
/** At most one sound this often (ms), like the game's text voice. */
const SOUND_GAP = 45;

interface Typing {
    channelId: string;
    guildId?: string;
    start: number;
    /** When each character of the text appears (ms after start). */
    times: number[];
    revealed: number;
}

const typing = new Map<string, Typing>();
let ticker: ReturnType<typeof setInterval> | undefined;
let lastSound = 0;

/** When each character appears: a steady pace, with pauses after punctuation like the game. */
export function schedule(text: string, perChar: number): number[] {
    const times: number[] = [];
    let t = 0;
    for (let i = 0; i < text.length; i++) {
        times.push(t);
        const c = text[i];
        t += c === "." || c === "!" || c === "?" ? perChar * 6 : c === "," || c === ";" || c === ":" ? perChar * 3 : c === "\n" ? perChar * 4 : perChar;
    }
    // Squeeze long messages so they don't take forever.
    const total = t;
    if (total > MAX_DURATION) return times.map(x => (x * MAX_DURATION) / total);
    return times;
}

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

function playVoice() {
    if (store.sound === false) return;
    const now = Date.now();
    if (now - lastSound < SOUND_GAP) return;
    lastSound = now;
    try {
        const source = voiceSource();
        if (source) void require("@core/deltacord/extras").playSoundSource(source);
    } catch { }
}

function tick() {
    const now = Date.now();
    for (const [id, t] of typing) {
        const raw = MessageStore.getMessage?.(t.channelId, id)?.content;
        const text = typeof raw === "string" ? raw : "";
        const n = revealedAt(t.times, now - t.start);
        if (n === t.revealed) continue;
        // A letter (not just spaces) appeared: the text voice.
        if (text.slice(t.revealed, n).trim()) playVoice();
        t.revealed = n;
        if (n >= t.times.length) typing.delete(id);
        redraw(t.channelId, id, t.guildId);
    }
    if (!typing.size && ticker) {
        clearInterval(ticker);
        ticker = undefined;
    }
}

function startTyping(message: any, guildId?: string) {
    const text = typeof message?.content === "string" ? message.content : "";
    if (!message?.id || !text.trim()) return;
    typing.set(message.id, {
        channelId: message.channel_id,
        guildId,
        start: Date.now(),
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
            const t = message?.id ? typing.get(message.id) : undefined;
            if (!t || !Array.isArray(message.content)) return;
            const fraction = t.times.length ? t.revealed / t.times.length : 1;
            const total = countNodes(message.content);
            // The letters still to come are drawn see-through, so the message keeps its full
            // size from the start and the chat doesn't jump around as it types.
            const [shown, rest] = splitNodes(message.content, Math.max(0, Math.round(total * fraction)));
            message.content = [...shown, ...invisible(rest)];
        } catch { }
    });
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
                    <TableSwitchRow label="My own messages too" value={store.own ?? false} onValueChange={(v: boolean) => void (store.own = v)} />
                </TableRowGroup>
                <TableRowGroup title="Text sound">
                    <TableSwitchRow label="Play a sound while typing" value={store.sound !== false} onValueChange={(v: boolean) => void (store.sound = v)} />
                    <TableRow label="Sound" subLabel={store.soundUrl ? store.soundUrl : "Deltacord's blip"} />
                    <TableRow label="Test the sound" onPress={() => {
                        lastSound = 0;
                        playVoice();
                    }} />
                </TableRowGroup>
                <TextInput label="Use your own sound (link to a short WAV, MP3 or OGG)" value={link} placeholder="https://…" onChange={setLink} />
                <Button
                    text={busy ? "Downloading…" : "Use this sound"}
                    disabled={busy || !link.trim()}
                    onPress={async () => {
                        setBusy(true);
                        try {
                            const extras = require("@core/deltacord/extras");
                            const file = await extras.downloadSound(link, "voice");
                            extras.removeSoundFile(store.soundFile);
                            store.soundFile = file;
                            store.soundUrl = link.trim();
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
                {store.soundUrl ? (
                    <Button text="Back to Deltacord's blip" variant="secondary" onPress={() => {
                        require("@core/deltacord/extras").removeSoundFile(store.soundFile);
                        store.soundFile = null;
                        store.soundUrl = null;
                    }} />
                ) : null}
                <Text variant="text-xs/medium" color="text-muted">
                    Only new messages in the chat you're looking at type out. The sound is downloaded once and kept on your phone, so a Discord attachment link works even after it expires.
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
            intercept(payload => {
                try {
                    if (payload.type !== "MESSAGE_CREATE" || payload.optimistic) return undefined;
                    const message = payload.message;
                    if (!message || message.channel_id !== SelectedChannelStore.getChannelId?.()) return undefined;
                    const mine = message.author?.id === UserStore.getCurrentUser?.()?.id;
                    if (mine && !store.own) return undefined;
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
