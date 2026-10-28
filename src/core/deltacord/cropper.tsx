/**
 * Deltacord's own image cropper, for avatars and banners (and anywhere else Discord crops).
 *
 * Discord crops with a separate Android screen that doesn't open in the patched app; when it
 * fails, Discord quietly uses the whole picture, so there's no way to zoom or move it. This
 * replaces Discord's `launchCropper` with a cropper drawn in the app: pinch to zoom, drag to move,
 * + and - buttons, and the crop itself is done by the Deltacord module. If anything here can't
 * work, Discord's own cropper is used as before.
 */
import { callNative } from "@lib/api/native/bridge";
import { before, instead } from "@lib/api/patcher";
import { dismissAlert, openAlert } from "@lib/ui/alerts";
import { onModuleLoaded } from "@metro/internals/modules";
import { showToast } from "@lib/ui/toasts";
import { useMemo, useRef, useState } from "react";
import { Dimensions, Image, Modal, PanResponder, Pressable, Text, View } from "react-native";

const KEY = "deltacord-cropper";
const MAX_ZOOM = 6;
const FONT = "ggsans-Normal";
const FONT_BOLD = "ggsans-Bold";

interface CropOptions {
    uri: string;
    width?: number;
    height?: number;
    mimeType?: string;
    freeStyleCropEnabled?: boolean;
}

interface Info { width: number; height: number; mime: string; }

/** What the cropper has done this session (for Doctor's self-test). */
export const cropperStatus = {
    patched: false,
    hooks: [] as string[],
    opened: 0,
    saved: 0,
    lastError: "",
    /** Which of Discord's image functions ran this session, and how often (for Doctor). */
    calls: {} as Record<string, number>,
};

/** A plain reason for a failure, pointing at the module when it's too old to crop. */
function reason(e: any): string {
    const message = String(e?.message ?? e ?? "unknown error");
    if (/bridge isn't available|unknown method|not (found|registered)|no such method|readAsDataURL|Cannot read|undefined/i.test(message)) {
        return `the Deltacord module may be out of date; update it to 1927 or newer (${message})`;
    }
    return message;
}

const cancelled = () => Object.assign(new Error("User cancelled image selection"), { code: "E_PICKER_CANCELLED" });

const distance = (touches: any[]) => {
    const [a, b] = touches;
    return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
};

function Cropper({ options, info, onDone, onCancel }: {
    options: CropOptions;
    info: Info;
    onDone: (rect: { x: number; y: number; w: number; h: number; }) => Promise<void>;
    onCancel: () => void;
}) {
    const screen = Dimensions.get("window");
    // The shape to crop: what Discord asked for (square for avatars, wide for banners).
    const aspect = options.width && options.height ? options.width / options.height : info.width / info.height;
    const frameW = Math.min(screen.width - 32, screen.height * 0.6 * aspect);
    const frameH = frameW / aspect;
    // Zoom 1: the picture just covers the frame.
    const fit = Math.max(frameW / info.width, frameH / info.height);

    const [zoom, setZoom] = useState(1);
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    const [busy, setBusy] = useState(false);
    const live = useRef({ zoom: 1, x: 0, y: 0 });
    const gesture = useRef({ count: 0, zoom: 1, x: 0, y: 0, dist: 1, px: 0, py: 0 });

    /** Keeps the picture covering the whole frame. */
    const clamp = (z: number, x: number, y: number) => {
        const zoomed = Math.min(MAX_ZOOM, Math.max(1, z));
        const maxX = (info.width * fit * zoomed - frameW) / 2;
        const maxY = (info.height * fit * zoomed - frameH) / 2;
        return { zoom: zoomed, x: Math.min(maxX, Math.max(-maxX, x)), y: Math.min(maxY, Math.max(-maxY, y)) };
    };
    const apply = (z: number, x: number, y: number) => {
        const next = clamp(z, x, y);
        live.current = next;
        setZoom(next.zoom);
        setOffset({ x: next.x, y: next.y });
    };

    const responder = useMemo(() => PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
            gesture.current.count = 0;
        },
        onPanResponderMove: evt => {
            const touches: any[] = evt.nativeEvent.touches ?? [];
            const g = gesture.current;
            const mid = touches.length >= 2
                ? { x: (touches[0].pageX + touches[1].pageX) / 2, y: (touches[0].pageY + touches[1].pageY) / 2 }
                : { x: touches[0]?.pageX ?? 0, y: touches[0]?.pageY ?? 0 };
            // A finger added or lifted: start measuring again from here.
            if (touches.length !== g.count) {
                g.count = touches.length;
                g.zoom = live.current.zoom;
                g.x = live.current.x;
                g.y = live.current.y;
                g.dist = touches.length >= 2 ? Math.max(1, distance(touches)) : 1;
                g.px = mid.x;
                g.py = mid.y;
                return;
            }
            const z = touches.length >= 2 ? g.zoom * (distance(touches) / g.dist) : g.zoom;
            apply(z, g.x + (mid.x - g.px), g.y + (mid.y - g.py));
        },
        onPanResponderRelease: () => {
            gesture.current.count = 0;
        },
        onPanResponderTerminationRequest: () => false,
    }), [info, frameW, frameH]);

    const shownW = info.width * fit * zoom;
    const shownH = info.height * fit * zoom;
    const left = (frameW - shownW) / 2 + offset.x;
    const top = (frameH - shownH) / 2 + offset.y;
    const round = Math.abs(aspect - 1) < 0.01;

    const button = (label: string, onPress: () => void, color = "#FFFFFF") => (
        <Pressable
            onPress={onPress}
            disabled={busy}
            style={{ paddingVertical: 12, paddingHorizontal: 16, borderWidth: 3, borderColor: color, minWidth: 64, alignItems: "center", opacity: busy ? 0.5 : 1 }}
        >
            <Text style={{ color, fontSize: 16, letterSpacing: 1, fontFamily: FONT_BOLD }}>{label}</Text>
        </Pressable>
    );

    return (
        <Modal visible transparent={false} animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
            <View style={{ flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center", gap: 22 }}>
                <Text style={{ color: "#FFFFFF", fontSize: 20, letterSpacing: 2, fontFamily: FONT_BOLD }}>EDIT IMAGE</Text>
                <View
                    {...responder.panHandlers}
                    style={{ width: frameW, height: frameH, overflow: "hidden", borderWidth: 3, borderColor: "#FFFFFF", backgroundColor: "#111" }}
                >
                    <Image
                        source={{ uri: options.uri }}
                        resizeMode="stretch"
                        style={{ position: "absolute", left, top, width: shownW, height: shownH }}
                    />
                    {round ? (
                        // Where your avatar's circle will be.
                        <View pointerEvents="none" style={{
                            position: "absolute", left: 0, top: 0, width: frameW - 6, height: frameH - 6,
                            borderRadius: frameW / 2, borderWidth: 2, borderColor: "rgba(255,255,255,0.8)",
                        }} />
                    ) : null}
                </View>
                <Text style={{ color: "#AAAAAA", fontSize: 13, fontFamily: FONT }}>Pinch to zoom · drag to move</Text>
                <View style={{ flexDirection: "row", gap: 12 }}>
                    {button("−", () => apply(live.current.zoom / 1.25, live.current.x, live.current.y))}
                    {button("RESET", () => apply(1, 0, 0))}
                    {button("+", () => apply(live.current.zoom * 1.25, live.current.x, live.current.y))}
                </View>
                <View style={{ flexDirection: "row", gap: 12 }}>
                    {button("CANCEL", onCancel)}
                    {button(busy ? "SAVING…" : "DONE", async () => {
                        setBusy(true);
                        const scale = fit * live.current.zoom;
                        const l = (frameW - info.width * scale) / 2 + live.current.x;
                        const t = (frameH - info.height * scale) / 2 + live.current.y;
                        try {
                            await onDone({ x: -l / scale, y: -t / scale, w: frameW / scale, h: frameH / scale });
                        } finally {
                            setBusy(false);
                        }
                    }, "#FFFF00")}
                </View>
            </View>
        </Modal>
    );
}

/** Opens Deltacord's cropper; resolves like Discord's cropper does. */
async function crop(options: CropOptions): Promise<any> {
    const info: Info = await Promise.race([
        callNative("deltacord.image.info", options.uri),
        new Promise<never>((_, fail) => setTimeout(() => fail(new Error("the module took too long to read the picture")), 10000)),
    ]);
    if (!info?.width || !info?.height) throw new Error("the module couldn't read the picture's size");
    cropperStatus.opened++;

    return new Promise((resolve, reject) => {
        const close = () => {
            try {
                dismissAlert(KEY);
            } catch { }
        };
        openAlert(KEY, <Cropper
            options={options}
            info={info}
            onCancel={() => {
                close();
                reject(cancelled());
            }}
            onDone={async rect => {
                try {
                    // Discord's size for the result (or the cropped area, capped).
                    const outW = options.width && options.height ? options.width : Math.min(2048, Math.round(rect.w));
                    const outH = options.width && options.height ? options.height : Math.round(outW * rect.h / rect.w);
                    const result = await callNative(
                        "deltacord.image.crop", options.uri,
                        rect.x, rect.y, rect.w, rect.h, outW, outH,
                        options.mimeType ?? info.mime ?? "image/png",
                    );
                    close();
                    cropperStatus.saved++;
                    resolve({
                        ...result,
                        cropRect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.w), height: Math.round(rect.h) },
                    });
                } catch (e) {
                    close();
                    reject(e);
                }
            }}
        />);
    });
}

/**
 * The patched functions (spitroast's proxies). A set, not a mark on the function: a mark would
 * land on Discord's original underneath, and a module still holding that original would be skipped.
 */
const ours = new WeakSet<object>();
const isOurs = (fn: any) => typeof fn === "function" && ours.has(fn);
/** True while Discord's own cropper is running as a fallback, so ours doesn't catch it again. */
let bypass = false;

/** Runs Deltacord's cropper for these options, or Discord's original if ours can't. */
async function cropOrFallback(options: CropOptions, fallback: () => any): Promise<any> {
    if (bypass || !options.uri) return fallback();
    try {
        return await crop(options);
    } catch (e: any) {
        if (e?.code === "E_PICKER_CANCELLED") throw e;
        // Deltacord's cropper couldn't run (old module, odd picture): Discord's own, as before,
        // but say why, so it isn't a silent "nothing happened".
        cropperStatus.lastError = reason(e);
        console.warn("[Deltacord] Cropper fell back to Discord's", e);
        try {
            showToast(`Deltacord's cropper couldn't open: ${cropperStatus.lastError}`);
        } catch { }
        bypass = true;
        try {
            return await fallback();
        } finally {
            bypass = false;
        }
    }
}

/**
 * Discord's crop functions, and how to read their options:
 * - launchCropper({ uri, width, height, mimeType }) (Discord's wrapper)
 * - openCropper({ path, width, height, mime }) (the crop library underneath, which returns the
 *   same { path, data, mime, width, height, cropRect } our cropper does)
 */
const TARGETS: Record<string, (o: any) => CropOptions> = {
    launchCropper: o => ({ uri: o?.uri, width: o?.width, height: o?.height, mimeType: o?.mimeType, freeStyleCropEnabled: o?.freeStyleCropEnabled }),
    openCropper: o => ({ uri: o?.path ?? o?.uri, width: o?.width, height: o?.height, mimeType: o?.mime ?? o?.mimeType, freeStyleCropEnabled: o?.freeStyleCropEnabled }),
};

/** Patches whichever crop functions this object has; returns the undo functions. */
function patchObject(target: any): Array<() => void> {
    const undo: Array<() => void> = [];
    for (const [name, read] of Object.entries(TARGETS)) {
        const fn = target?.[name];
        // Already ours (a module that re-exports a patched function): leave it.
        if (typeof fn !== "function" || isOurs(fn)) continue;
        try {
            undo.push(instead(name, target, (args: any[], orig: Function) => cropOrFallback(read(args[0] ?? {}), () => orig(...args))));
            ours.add(target[name]);
            cropperStatus.patched = true;
            if (!cropperStatus.hooks.includes(name)) cropperStatus.hooks.push(name);
        } catch (e) {
            cropperStatus.lastError = `couldn't patch Discord's ${name}: ${String((e as any)?.message ?? e)}`;
        }
    }
    return undo;
}

/** Discord's image functions we only count, so Doctor shows which ones a version really uses. */
const WATCHED = ["openImagePicker", "openImagePickerUnhandled", "launchImageLibrary", "launchImageLibraryAsync", "openPicker", "launchCropper", "openCropper"];

/** True while a picker we cropped after is running, so an inner picker isn't cropped twice. */
let pickerDepth = 0;

/** Animated pictures stay whole (cropping would freeze them), as Discord does. */
const ANIMATED = /image\/(gif|webp|avif)/i;

/**
 * Discord's image picker for avatars, banners and icons: openImagePicker(Unhandled)({ width,
 * height } or { size }) resolves { base64: "data:...", mimeType }. If Discord didn't let you crop
 * inside it (its cropper doesn't open in the patched app), Deltacord's cropper opens on the
 * picture it chose, and the cropped picture is returned instead.
 */
function patchPicker(target: any, name: string): Array<() => void> {
    const fn = target?.[name];
    if (typeof fn !== "function" || isOurs(fn)) return [];
    const undo = instead(name, target, async (args: any[], orig: Function) => {
        const options = args[0] ?? {};
        const width = options.size ?? options.width;
        const height = options.size ?? options.height;
        if (pickerDepth > 0 || !width || !height) return orig(...args);
        const openedBefore = cropperStatus.opened;
        const errorBefore = cropperStatus.lastError;
        pickerDepth++;
        let result: any;
        try {
            result = await orig(...args);
        } finally {
            pickerDepth--;
        }
        // Our cropper already ran inside (launchCropper/openCropper were reached), or nothing picked.
        if (cropperStatus.opened !== openedBefore || cropperStatus.lastError !== errorBefore) return result;
        const uri = result?.base64;
        if (typeof uri !== "string" || !uri.startsWith("data:")) return result;
        const mime = result.mimeType ?? uri.slice(5, uri.indexOf(";"));
        if (ANIMATED.test(mime)) return result;
        try {
            const cropped = await crop({ uri, width, height, mimeType: mime });
            return { ...result, base64: `data:${cropped.mime};base64,${cropped.data}`, mimeType: cropped.mime };
        } catch (e: any) {
            // Cancelled in our cropper: Discord treats that like cancelling the picker.
            if (e?.code === "E_PICKER_CANCELLED") throw e;
            cropperStatus.lastError = reason(e);
            try {
                showToast(`Deltacord's cropper couldn't open: ${cropperStatus.lastError}`);
            } catch { }
            return result;
        }
    });
    ours.add(target[name]);
    if (!cropperStatus.hooks.includes(name)) cropperStatus.hooks.push(name);
    cropperStatus.patched = true;
    return [undo];
}

function countCalls(target: any, names: string[]): Array<() => void> {
    const undo: Array<() => void> = [];
    for (const name of names) {
        if (typeof target?.[name] !== "function") continue;
        try {
            undo.push(before(name, target, () => {
                cropperStatus.calls[name] = (cropperStatus.calls[name] ?? 0) + 1;
            }));
        } catch { }
    }
    return undo;
}

/**
 * Patches Discord's image picking and crop functions as Discord loads them (usually when you
 * edit your profile), in every module that has them. They must not be looked up at startup: an
 * uncached lookup loads every Discord module early, which broke the app after updating.
 */
export function patchCropper(): () => void {
    const undo: Array<() => void> = [];
    const seen = new WeakSet<object>();
    const handle = (target: any) => {
        if (!target || (typeof target !== "object" && typeof target !== "function") || seen.has(target)) return;
        seen.add(target);
        if (!WATCHED.some(name => typeof target[name] === "function")) return;
        // Functions another module already re-exported from a patched one are ours: count and
        // patch only the rest (so nothing is wrapped twice).
        const fresh = WATCHED.filter(name => typeof target[name] === "function" && !isOurs(target[name]));
        if (!fresh.length) return;
        undo.push(...patchObject(target));
        // The wrapper picks the outermost picker: Unhandled is the one doing the work.
        undo.push(...patchPicker(target, "openImagePickerUnhandled"));
        if (typeof target.openImagePickerUnhandled !== "function") undo.push(...patchPicker(target, "openImagePicker"));
        undo.push(...countCalls(target, fresh));
    };
    const stop = onModuleLoaded(exports => {
        handle(exports);
        if (exports?.default && exports.default !== exports) handle(exports.default);
    });
    return () => {
        stop();
        undo.forEach(u => u());
    };
}
