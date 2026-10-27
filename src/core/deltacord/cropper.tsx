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
import { instead } from "@lib/api/patcher";
import { dismissAlert, openAlert } from "@lib/ui/alerts";
import { findByProps } from "@metro/wrappers";
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
    const info: Info = await callNative("deltacord.image.info", options.uri);
    if (!info?.width || !info?.height) throw new Error("No image size");

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

export function patchCropper(): () => void {
    const picker = findByProps("launchCropper");
    if (typeof picker?.launchCropper !== "function") {
        console.error("[Deltacord] Couldn't find Discord's image cropper");
        return () => { };
    }
    return instead("launchCropper", picker, async (args: any[], orig: Function) => {
        const options: CropOptions = args[0] ?? {};
        if (!options.uri) return orig(...args);
        try {
            return await crop(options);
        } catch (e: any) {
            if (e?.code === "E_PICKER_CANCELLED") throw e;
            // Deltacord's cropper couldn't run (old module, odd picture): Discord's own, as before.
            console.warn("[Deltacord] Cropper fell back to Discord's", e);
            return orig(...args);
        }
    });
}
