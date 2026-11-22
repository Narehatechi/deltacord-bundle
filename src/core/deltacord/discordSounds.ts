/**
 * Replace Discord's own sounds (message, mention, calls, joining and leaving, mute…).
 *
 * Discord plays its sounds through its native sound player (DCDSoundManager): it first prepares
 * each sound by name (message1, mention1, user_join…) and then plays it by id. Deltacord swaps the
 * name for your sound file when it's prepared, so Discord plays yours instead, with the same volume
 * and timing as its own. Every name Discord prepares is remembered, so new or renamed sounds in a
 * later Discord show up in the list on their own.
 */
import { createMMKVBackend, createStorage, wrapSync } from "@core/vendetta/storage";
import { NativeFileModule } from "@lib/api/native/modules";
import { ReactNative } from "@metro/common";

export interface Replacement {
    /** A file:// path kept on the phone, or "silent". */
    file: string;
    /** What it's called (a file's name or a link). */
    name: string;
}

export const discordSounds = wrapSync(createStorage<{
    replacements?: Record<string, Replacement>;
    /** Sound names Discord has used on this phone. */
    seen?: string[];
}>(createMMKVBackend("DELTACORD_DISCORD_SOUNDS")));

/** Friendly names for Discord's sounds (the rest show by their own name). */
export const KNOWN_SOUNDS: Record<string, string> = {
    message1: "New message",
    message2: "New message (2)",
    message3: "New message (3)",
    mention1: "Mention",
    mention2: "Mention (2)",
    mention3: "Mention (3)",
    call_calling: "Calling someone",
    call_ringing: "Incoming call",
    call_ringing_beat: "Incoming call (beat)",
    user_join: "Someone joins voice",
    user_leave: "Someone leaves voice",
    user_moved: "Moved to another channel",
    disconnect: "Disconnected from voice",
    reconnect: "Reconnected",
    mute: "Mute",
    unmute: "Unmute",
    deafen: "Deafen",
    undeafen: "Undeafen",
    ptt_start: "Push to talk on",
    ptt_stop: "Push to talk off",
    stream_started: "Go Live started",
    stream_ended: "Go Live ended",
    stream_user_joined: "Someone joins your stream",
    stream_user_left: "Someone leaves your stream",
    activity_launch: "Activity starts",
    activity_end: "Activity ends",
};

/** The sound's name from what Discord prepares ("message1", ".../message1.mp3", "asset:/sounds/mention1.wav"). */
export function soundName(source: unknown): string | null {
    if (typeof source !== "string" || !source) return null;
    if (source.includes("/deltacord-sounds/")) return null; // Deltacord's own and your files
    const base = source.split("?")[0].split("/").pop()!.replace(/\.(mp3|wav|ogg|m4a|aac)$/i, "");
    return /^[a-z0-9_-]{2,40}$/i.test(base) ? base : null;
}

const SILENT_FILE = "pyoncord/deltacord-sounds/silent.wav";

/** A tiny silent WAV, for sounds you want gone. */
async function silentFile(): Promise<string> {
    const full = `${NativeFileModule.getConstants().DocumentsDirPath}/${SILENT_FILE}`;
    if (!await NativeFileModule.fileExists(full)) {
        // 44-byte header + 800 bytes of silence (8 kHz, 8-bit mono, 0.1 s).
        const bytes = new Uint8Array(44 + 800);
        const view = new DataView(bytes.buffer);
        const text = (at: number, s: string) => [...s].forEach((c, i) => bytes[at + i] = c.charCodeAt(0));
        text(0, "RIFF"); view.setUint32(4, 36 + 800, true); text(8, "WAVE");
        text(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
        view.setUint32(24, 8000, true); view.setUint32(28, 8000, true); view.setUint16(32, 1, true); view.setUint16(34, 8, true);
        text(36, "data"); view.setUint32(40, 800, true);
        bytes.fill(128, 44);
        const { toBase64 } = require("./bytes");
        await NativeFileModule.writeFile("documents", SILENT_FILE, toBase64(bytes), "base64");
    }
    return `file://${full}`;
}

let silentPath: string | null = null;

/** What Discord should prepare instead of [name], or null to leave it. */
function replacementFor(name: string): string | null {
    const r = discordSounds.replacements?.[name];
    if (!r) return null;
    if (r.file === "silent") return silentPath;
    return r.file;
}

/** Discord's last prepare call for each sound, so a change can take effect without a restart. */
const lastPrepare = new Map<string, any[]>();
let original: ((...args: any[]) => any) | null = null;
export const discordSoundsStatus = { patched: false, error: "" };

function note(name: string) {
    const seen = discordSounds.seen ?? [];
    if (!seen.includes(name)) discordSounds.seen = [...seen, name].slice(-80);
}

/** Starts swapping Discord's sounds. Call as early as possible (Discord prepares sounds when it starts). */
export function patchDiscordSounds() {
    try {
        const manager = ReactNative.NativeModules?.DCDSoundManager;
        if (!manager?.prepare || original) return;
        original = manager.prepare.bind(manager);
        silentFile().then(p => silentPath = p).catch(() => { });
        manager.prepare = (source: any, ...rest: any[]) => {
            const name = soundName(source);
            if (name) {
                try {
                    note(name);
                    lastPrepare.set(name, [source, ...rest]);
                    const swap = replacementFor(name);
                    if (swap) return original!(swap, ...rest);
                } catch { }
            }
            return original!(source, ...rest);
        };
        discordSoundsStatus.patched = manager.prepare !== original;
    } catch (e: any) {
        discordSoundsStatus.error = String(e?.message ?? e).slice(0, 120);
        console.error("[Deltacord] Couldn't hook Discord's sounds", e);
    }
}

/** Prepares [name] again (with your sound, or Discord's), so a change works straight away. */
function reprepare(name: string) {
    const args = lastPrepare.get(name);
    if (!args || !original) return;
    const [source, usage, id] = args;
    const swap = replacementFor(name);
    try {
        original(swap ?? source, usage, id, () => { });
    } catch { }
}

export function setReplacement(name: string, replacement: Replacement | null) {
    const all = { ...(discordSounds.replacements ?? {}) };
    const old = all[name]?.file;
    if (replacement) all[name] = replacement;
    else delete all[name];
    discordSounds.replacements = all;
    if (old && old !== "silent" && old !== replacement?.file) require("./extras").removeSoundFile(old);
    reprepare(name);
}

/** Plays what Discord will play for [name] now (yours or Discord's), if Discord has used it this session. */
export function previewDiscordSound(name: string): boolean {
    const args = lastPrepare.get(name);
    const own = discordSounds.replacements?.[name];
    if (own && own.file !== "silent") {
        void require("./extras").playSoundSource(own.file);
        return true;
    }
    if (!args) return false;
    try {
        const manager = ReactNative.NativeModules?.DCDSoundManager;
        manager?.stop?.(args[2]);
        manager?.play?.(args[2]);
        return true;
    } catch {
        return false;
    }
}

/** Every sound to show: the ones Discord has used, then the known ones it hasn't yet. */
export function listDiscordSounds(): { name: string; label: string; seen: boolean; }[] {
    const seen = discordSounds.seen ?? [];
    const names = [...seen, ...Object.keys(KNOWN_SOUNDS).filter(k => !seen.includes(k)), ...Object.keys(discordSounds.replacements ?? {}).filter(k => !seen.includes(k) && !(k in KNOWN_SOUNDS))];
    return names.map(name => ({ name, label: KNOWN_SOUNDS[name] ?? name.replace(/[_-]+/g, " "), seen: seen.includes(name) }));
}
