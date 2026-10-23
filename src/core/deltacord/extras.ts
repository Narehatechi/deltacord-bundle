/**
 * Small Undertale/Deltarune-flavoured touches (original sounds, no game assets):
 * - text blips: a soft 8-bit blip when a message arrives in the channel you're looking at,
 * - a "★ Saved" toast (and chime) when you change themes, fonts or Deltacord settings.
 */
import { createMMKVBackend, createStorage, wrapSync } from "@core/vendetta/storage";
import { findAssetId } from "@lib/api/assets";
import { intercept } from "@lib/api/flux";
import { showToast } from "@lib/ui/toasts";
import { ReactNative } from "@metro/common";
import { findByStoreNameLazy } from "@metro/wrappers";
import { NativeFileModule } from "@lib/api/native/modules";

import { download, sniffType, toBase64 } from "./bytes";

const SOUNDS = "https://raw.githubusercontent.com/Narehatechi/deltacord-bundle/main/themes/sounds";

export interface ExtrasSettings {
    textBlips: boolean;
    lowBlips: boolean;
    saveToasts: boolean;
    saveChime: boolean;
    /** Deltacord's themes switch the font to Determination. */
    themeFont: boolean;
    // Bookkeeping for the theme font (not shown as switches).
    fontBeforeTheme?: string | null;
    fontSetByTheme?: boolean;
    themeFontPrompted?: boolean;
    /** Your own save sound: the link it came from, and where the downloaded copy is kept. */
    saveSoundUrl?: string | null;
    saveSoundFile?: string | null;
    /** Play the save sound when saving a profile. */
    profileSaveSound: boolean;
}

export const DEFAULT_EXTRAS: ExtrasSettings = { textBlips: false, lowBlips: false, saveToasts: true, saveChime: false, themeFont: true, profileSaveSound: true };

export const extrasSettings = wrapSync(createStorage<Partial<ExtrasSettings>>(createMMKVBackend("DELTACORD_EXTRAS")));
export const getExtras = (): ExtrasSettings => ({ ...DEFAULT_EXTRAS, ...(extrasSettings ?? {}) } as ExtrasSettings);

const SelectedChannelStore = findByStoreNameLazy("SelectedChannelStore");
const UserStore = findByStoreNameLazy("UserStore");

// ------------------------------------------------------------------ sounds

const SoundManager = () => ReactNative.NativeModules?.DCDSoundManager;
const prepared = new Map<string, Promise<boolean>>();
const SOUND_IDS: Record<string, number> = { "blip.wav": 7301, "blip-low.wav": 7302, "save.wav": 7303 };

let nextSoundId = 7310;
const sourceIds = new Map<string, number>();
const idFor = (source: string) => {
    if (!sourceIds.has(source)) sourceIds.set(source, SOUND_IDS[source.split("/").pop()!] ?? nextSoundId++);
    return sourceIds.get(source)!;
};

/** Loads a sound (a link or a file:// path) into Discord's sound player. */
function prepareSource(source: string): Promise<boolean> {
    if (!prepared.has(source)) {
        prepared.set(source, new Promise(resolve => {
            try {
                const manager = SoundManager();
                if (!manager?.prepare) return resolve(false);
                manager.prepare(source, "notification", idFor(source), (error: unknown) => resolve(!error));
            } catch {
                resolve(false);
            }
        }));
    }
    return prepared.get(source)!;
}

async function playSource(source: string): Promise<boolean> {
    try {
        if (!await prepareSource(source)) return false;
        const manager = SoundManager();
        manager?.stop?.(idFor(source));
        await manager?.play?.(idFor(source));
        return true;
    } catch {
        return false;
    }
}

const play = (file: string) => playSource(`${SOUNDS}/${file}`);

// --------------------------------------------------------------- save sound

const CUSTOM_SOUND_DIR = "deltacord-sounds";

/** Your own save sound if you set one (the downloaded copy first, then its link), else Deltacord's. */
async function playSave() {
    const { saveSoundFile, saveSoundUrl } = getExtras();
    if (saveSoundFile && await playSource(saveSoundFile)) return;
    if (saveSoundUrl && await playSource(saveSoundUrl)) return;
    await play("save.wav");
}

/**
 * The save sound. Profile saves always play it (unless switched off on the Profiles page);
 * other saves only with "Save chime" on.
 */
export function playSaveSound({ always = false } = {}) {
    const settings = getExtras();
    if (always ? !settings.profileSaveSound : !settings.saveChime) return;
    void playSave();
}

/**
 * Uses the sound at this link as the save sound. It's downloaded once and kept on the phone, so
 * links that expire later (like Discord attachment links) keep working.
 */
export async function setCustomSaveSound(url: string) {
    url = url.trim();
    if (!/^https:\/\//i.test(url)) throw new Error("That needs to be a link starting with https://");
    const bytes = await download(url);
    if (bytes.length > 2 * 1024 * 1024) throw new Error("That sound is over 2 MB; save sounds should be short");
    const type = sniffType(bytes, "");
    if (!type.startsWith("audio/")) throw new Error("That link isn't a WAV, MP3 or OGG sound");

    const ext = type === "audio/wav" ? "wav" : type === "audio/ogg" ? "ogg" : "mp3";
    const name = `save-${Date.now().toString(36)}.${ext}`;
    await NativeFileModule.writeFile("documents", `pyoncord/${CUSTOM_SOUND_DIR}/${name}`, toBase64(bytes), "base64");

    removeCustomSoundFile();
    extrasSettings.saveSoundUrl = url;
    extrasSettings.saveSoundFile = `file://${NativeFileModule.getConstants().DocumentsDirPath}/pyoncord/${CUSTOM_SOUND_DIR}/${name}`;
    await playSave();
}

function removeCustomSoundFile() {
    const file = extrasSettings.saveSoundFile;
    const marker = `/pyoncord/${CUSTOM_SOUND_DIR}/`;
    if (!file?.includes(marker)) return;
    try {
        NativeFileModule.removeFile?.("documents", `pyoncord/${CUSTOM_SOUND_DIR}/${file.split(marker)[1]}`)?.catch?.(() => { });
    } catch { }
}

export function resetSaveSound() {
    removeCustomSoundFile();
    extrasSettings.saveSoundUrl = null;
    extrasSettings.saveSoundFile = null;
}

// --------------------------------------------------------------- text blips

let lastBlip = 0;

function onMessage(payload: any) {
    const settings = getExtras();
    if (!settings.textBlips) return;
    const message = payload.message;
    if (!message || payload.optimistic || payload.isPushNotification) return;
    if (message.author?.id && message.author.id === UserStore.getCurrentUser?.()?.id) return;
    if (payload.channelId !== SelectedChannelStore.getChannelId?.()) return;
    if (ReactNative.AppState?.currentState && ReactNative.AppState.currentState !== "active") return;

    const now = Date.now();
    if (now - lastBlip < 120) return; // a burst of messages blips once, not machine-gun
    lastBlip = now;
    play(settings.lowBlips ? "blip-low.wav" : "blip.wav");
}

// ---------------------------------------------------------------- save toast

let ready = false;

/** True once startup is over, so changes can be treated as the user's own. */
export const isUserTime = () => ready;

/** "★ Saved" after a change the user made (quiet during startup, when Deltacord itself saves things). */
export function announceSave(what = "Saved") {
    if (!ready) return;
    const settings = getExtras();
    if (!settings.saveToasts) return;
    try {
        showToast(`★ ${what}`, findAssetId("StarIcon") ?? findAssetId("CheckmarkLargeIcon"));
    } catch { }
    playSaveSound();
}

export function previewSound(kind: "blip" | "low" | "save") {
    if (kind === "save") void playSave();
    else void play(kind === "blip" ? "blip.wav" : "blip-low.wav");
}

/** Starts the extras; returns how to stop them. */
export function initExtras() {
    const unintercept = intercept(payload => {
        if (payload.type === "MESSAGE_CREATE") {
            try {
                onMessage(payload);
            } catch { }
        }
    });
    // Anything saved in the first moments is Deltacord's own startup work, not the user.
    const timer = setTimeout(() => (ready = true), 8000);
    return () => {
        unintercept();
        clearTimeout(timer);
        ready = false;
    };
}
