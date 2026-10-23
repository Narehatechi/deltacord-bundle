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
}

export const DEFAULT_EXTRAS: ExtrasSettings = { textBlips: false, lowBlips: false, saveToasts: true, saveChime: false, themeFont: true };

export const extrasSettings = wrapSync(createStorage<Partial<ExtrasSettings>>(createMMKVBackend("DELTACORD_EXTRAS")));
export const getExtras = (): ExtrasSettings => ({ ...DEFAULT_EXTRAS, ...(extrasSettings ?? {}) } as ExtrasSettings);

const SelectedChannelStore = findByStoreNameLazy("SelectedChannelStore");
const UserStore = findByStoreNameLazy("UserStore");

// ------------------------------------------------------------------ sounds

const SoundManager = () => ReactNative.NativeModules?.DCDSoundManager;
const prepared = new Map<string, Promise<boolean>>();
const SOUND_IDS: Record<string, number> = { "blip.wav": 7301, "blip-low.wav": 7302, "save.wav": 7303 };

function prepare(file: string): Promise<boolean> {
    if (!prepared.has(file)) {
        prepared.set(file, new Promise(resolve => {
            try {
                const manager = SoundManager();
                if (!manager?.prepare) return resolve(false);
                manager.prepare(`${SOUNDS}/${file}`, "notification", SOUND_IDS[file], (error: unknown) => resolve(!error));
            } catch {
                resolve(false);
            }
        }));
    }
    return prepared.get(file)!;
}

async function play(file: string) {
    try {
        if (!await prepare(file)) return;
        const manager = SoundManager();
        manager?.stop?.(SOUND_IDS[file]);
        await manager?.play?.(SOUND_IDS[file]);
    } catch { }
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
    if (settings.saveChime) play("save.wav");
}

export function previewSound(kind: "blip" | "low" | "save") {
    play(kind === "blip" ? "blip.wav" : kind === "low" ? "blip-low.wav" : "save.wav");
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
