/**
 * A Jukebox button in the voice call controls, right after Discord's soundboard button.
 *
 * Discord's call controls (the dock with camera, mic, screen share, soundboard and hang up) are
 * made of buttons named like VoicePanelSoundboardButton. When the dock makes that one, a copy of
 * it is put next to it with a music icon, that opens the Jukebox in a sheet instead.
 */
import { after } from "@lib/api/patcher";
import { ErrorBoundary } from "@lib/ui/components";
import { showSheet } from "@lib/ui/sheets";
import { ActionSheet } from "@metro/common/components";
import { findByProps, findByPropsLazy } from "@metro/wrappers";
import { Component, Fragment, cloneElement, createElement, isValidElement } from "react";

import JukeboxPage, { jukebox } from "./JukeboxPage";

const TARGET = "VoicePanelSoundboardButton";
export const jukeboxButtonStatus = { found: false, drawn: 0, error: "" };

function JukeboxSheet() {
    // Its own safety net: a problem in the sheet shows here instead of the crash screen.
    return <ActionSheet>
        <ErrorBoundary>
            <JukeboxPage inSheet />
        </ErrorBoundary>
    </ActionSheet>;
}

const openSheet = () => showSheet("DeltacordJukebox", JukeboxSheet);

/** A music icon from Discord's own icons, in the same form as the one it replaces. */
let musicIcon: any;
function iconComponent() {
    if (musicIcon !== undefined) return musicIcon;
    for (const name of ["MusicIcon", "HeadphonesIcon", "SpeakerIcon", "PlayIcon"]) {
        try {
            const found = findByProps(name)?.[name];
            if (found) return musicIcon = found;
        } catch { }
    }
    return musicIcon = null;
}

const isSoundboardIcon = (value: any) => {
    const name = value?.displayName ?? value?.name ?? value?.type?.name ?? value?.render?.name;
    return typeof name === "string" && /Soundboard/i.test(name);
};

/** The soundboard button, turned into the Jukebox button. */
function asJukebox(node: any, depth = 0): any {
    if (depth > 8 || !isValidElement(node)) return node;
    const props: any = node.props ?? {};
    const next: Record<string, any> = {};
    for (const [key, value] of Object.entries(props)) {
        if (key === "onPress") next[key] = openSheet;
        else if (key === "onLongPress" || key === "onPressIn" || key === "onPressOut") next[key] = undefined;
        else if (key === "accessibilityLabel" || key === "label") next[key] = "Jukebox";
        else if (typeof value === "function" && isSoundboardIcon(value) && iconComponent()) next[key] = iconComponent();
        else if (isValidElement(value)) next[key] = asJukebox(value, depth + 1);
        else if (Array.isArray(value)) next[key] = value.map(v => asJukebox(v, depth + 1));
    }
    // An icon drawn as an element of the soundboard icon itself.
    if (isSoundboardIcon(node.type) && iconComponent()) return createElement(iconComponent(), { ...props, ...next });
    return cloneElement(node, next);
}

const MEMO = Symbol.for("react.memo");
const FORWARD_REF = Symbol.for("react.forward_ref");

/**
 * The function that draws a component, whether plain, memo(...) or forwardRef(...). Class
 * components can't be drawn this way, so they're left alone.
 */
function renderOf(type: any): ((props: any) => any) | undefined {
    if (typeof type === "function") return type.prototype?.isReactComponent ? undefined : type;
    if (type?.$$typeof === MEMO) return renderOf(type.type);
    if (type?.$$typeof === FORWARD_REF && typeof type.render === "function") return (props: any) => type.render(props, null);
    return undefined;
}

/**
 * A component's name. Only real React components are looked into: Deltacord's own lazy
 * components look things up when touched, and doing that here could throw.
 */
function nameOf(type: any): string | undefined {
    let name: any;
    if (typeof type === "function") name = type.displayName ?? type.name;
    else if (type?.$$typeof === MEMO) return nameOf(type.type);
    else if (type?.$$typeof === FORWARD_REF) name = type.displayName ?? type.render?.displayName ?? type.render?.name;
    return typeof name === "string" ? name : undefined;
}

/** After any problem, the button stays away until Discord restarts, so nothing can keep crashing. */
let broken = false;
function giveUp(e: unknown) {
    broken = true;
    jukeboxButtonStatus.error = String((e as Error)?.message ?? e);
    console.error("[Deltacord] The Jukebox call button hit a problem and is off until restart", e);
}

/** Whatever happens inside, the Jukebox button draws nothing rather than breaking the call screen. */
class Contained extends Component<{ children: any; }, { failed: boolean; }> {
    state = { failed: false };
    static getDerivedStateFromError() {
        return { failed: true };
    }
    componentDidCatch(e: unknown) {
        giveUp(e);
    }
    render() {
        return this.state.failed ? null : this.props.children;
    }
}

/** Names of call parts Discord has made this session, so the Jukebox page can show what's there. */
export const seenCallParts = new Set<string>();

/** Is this the soundboard button (the Jukebox button goes right after it)? */
const isTarget = (name: string) => name === TARGET || (/Soundboard/.test(name) && /Button$/.test(name) && !/Picker|Sheet|Upsell|Item|Sound(Preview|Button)/.test(name));

/**
 * Discord's soundboard button, drawn again as the Jukebox button. The soundboard button's own
 * code runs (so it looks and behaves like the others in the dock), then its press and icon are
 * swapped.
 */
function JukeboxDockButton({ soundboardButton, ...props }: { soundboardButton: (props: any) => any; [key: string]: any; }) {
    if (broken) return null;
    return asJukebox(soundboardButton(props));
}

function withJukebox(type: any, ret: any) {
    const render = renderOf(type);
    if (!render || !isValidElement(ret)) return ret;
    jukeboxButtonStatus.found = true;
    if (jukebox.button === false) return ret;
    jukeboxButtonStatus.drawn++;
    return createElement(Fragment, { key: (ret as any).key ?? undefined },
        ret,
        createElement(Contained, { key: "deltacord-jukebox" },
            createElement(JukeboxDockButton, { ...(ret as any).props, soundboardButton: render })),
    );
}

const jsxRuntime = findByPropsLazy("jsx", "jsxs");

let started = false;
export function startJukeboxButton() {
    if (started) return;
    started = true;
    // The soundboard button is made inside the call dock's own code, so it's caught as the dock
    // creates it, whatever wrapper it comes in.
    const onCreate = (args: any[], ret: any) => {
        if (broken) return ret;
        try {
            const type = args[0];
            if (!type || typeof type === "string") return ret;
            const name = nameOf(type);
            if (!name || (name.indexOf("Soundboard") < 0 && name.indexOf("VoicePanel") < 0 && name.indexOf("Dock") < 0)) return ret;
            if (seenCallParts.size < 80) seenCallParts.add(name);
            return isTarget(name) ? withJukebox(type, ret) : ret;
        } catch (e) {
            giveUp(e);
            return ret;
        }
    };
    for (const key of ["jsx", "jsxs"]) {
        try {
            after(key, jsxRuntime, onCreate);
        } catch (e) {
            jukeboxButtonStatus.error = String((e as Error)?.message ?? e);
        }
    }
}
