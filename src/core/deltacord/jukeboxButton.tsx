/**
 * A Jukebox button in the voice call controls, right after Discord's soundboard button.
 *
 * Discord's call controls (the dock with camera, mic, screen share, soundboard and hang up) are
 * made of buttons named like VoicePanelSoundboardButton. When the dock makes that one, a copy of
 * it is put next to it with a music icon, that opens the Jukebox in a sheet instead.
 */
import { onJsxCreate } from "@lib/api/react/jsx";
import { showSheet } from "@lib/ui/sheets";
import { ActionSheet } from "@metro/common/components";
import { findByProps } from "@metro/wrappers";
import { Fragment, cloneElement, createElement, isValidElement } from "react";

import JukeboxPage, { jukebox } from "./JukeboxPage";

const TARGET = "VoicePanelSoundboardButton";
export const jukeboxButtonStatus = { found: false, drawn: 0, error: "" };

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

/**
 * Discord's soundboard button, drawn again as the Jukebox button. The soundboard button's own
 * code runs (so it looks and behaves like the others in the dock), then its press and icon are
 * swapped.
 */
function JukeboxDockButton({ soundboardButton, ...props }: { soundboardButton: (props: any) => any; [key: string]: any; }) {
    const res = soundboardButton(props);
    try {
        return asJukebox(res);
    } catch (e) {
        jukeboxButtonStatus.error = String((e as Error)?.message ?? e);
        return null;
    }
}

let started = false;
export function startJukeboxButton() {
    if (started) return;
    started = true;
    // The soundboard button is made inside the dock's own code, so it's caught as it's created.
    onJsxCreate(TARGET, (Component: any, ret: any) => {
        try {
            jukeboxButtonStatus.found = true;
            if (jukebox.button === false || !isValidElement(ret) || typeof Component !== "function") return ret;
            jukeboxButtonStatus.drawn++;
            return createElement(Fragment, { key: (ret as any).key ?? undefined },
                ret,
                createElement(JukeboxDockButton, { ...(ret as any).props, soundboardButton: Component, key: "deltacord-jukebox" }),
            );
        } catch (e) {
            jukeboxButtonStatus.error = String((e as Error)?.message ?? e);
            return ret;
        }
    });
}
