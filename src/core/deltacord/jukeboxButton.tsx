/**
 * A Jukebox button in the voice call controls, right after Discord's soundboard button.
 *
 * Discord's call controls (the dock with camera, mic, screen share, soundboard and hang up) are
 * made of buttons named like VoicePanelSoundboardButton. When that one draws, a copy of it is
 * drawn next to it with a music icon, that opens the Jukebox in a sheet instead.
 */
import { after } from "@lib/api/patcher";
import { showSheet } from "@lib/ui/sheets";
import { ActionSheet } from "@metro/common/components";
import { onModuleLoaded } from "@metro/internals/modules";
import { findByProps } from "@metro/wrappers";
import { Fragment, cloneElement, createElement, isValidElement } from "react";

import JukeboxPage, { jukebox } from "./JukeboxPage";

const TARGET = "VoicePanelSoundboardButton";
export const jukeboxButtonStatus = { found: false, drawn: 0, error: "" };

const patched = new WeakSet<object>();

function JukeboxSheet() {
    return <ActionSheet>
        <JukeboxPage inSheet />
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

function patch(container: any, key: string) {
    if (patched.has(container)) return;
    patched.add(container);
    jukeboxButtonStatus.found = true;
    after(key, container, (_args: any[], res: any) => {
        try {
            if (jukebox.button === false || !isValidElement(res)) return res;
            jukeboxButtonStatus.drawn++;
            return <Fragment>
                {res}
                <Fragment key="deltacord-jukebox">{asJukebox(res)}</Fragment>
            </Fragment>;
        } catch (e) {
            jukeboxButtonStatus.error = String((e as Error)?.message ?? e);
            return res;
        }
    });
}

const named = (fn: any) => typeof fn === "function" && (fn.displayName ?? fn.name) === TARGET;

function scan(exports: any) {
    if (!exports || (typeof exports !== "object" && typeof exports !== "function")) return;
    const keys = typeof exports === "object" ? Object.keys(exports).slice(0, 24) : [];
    for (const key of ["default", ...keys.filter(k => k !== "default")]) {
        let value: any;
        try {
            value = exports[key];
        } catch {
            continue;
        }
        if (named(value)) patch(exports, key);
        else if (value && typeof value === "object") {
            // memo(...) and forwardRef(...) keep the real function inside.
            if (named(value.type)) patch(value, "type");
            else if (named(value.render)) patch(value, "render");
        }
    }
}

let started = false;
export function startJukeboxButton() {
    if (started) return;
    started = true;
    onModuleLoaded(exports => {
        try {
            scan(exports);
        } catch { }
    });
}
