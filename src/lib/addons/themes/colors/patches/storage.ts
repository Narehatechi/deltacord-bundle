import { _colorRef } from "@lib/addons/themes/colors/updater";
import { after, before } from "@lib/api/patcher";
import { findInTree } from "@lib/utils";
import { proxyLazy } from "@lib/utils/lazy";
import { findByProps } from "@metro";

const mmkvStorage = proxyLazy(() => {
    const newModule = findByProps("impl");
    if (typeof newModule?.impl === "object") return newModule.impl;
    return findByProps("storage");
});

export default function patchStorage() {
    const patchedKeys = new Set(["ThemeStore", "SelectivelySyncedUserSettingsStore"]);

    const patches = [
        after("get", mmkvStorage, ([key], ret) => {
            if (!_colorRef.current || !patchedKeys.has(key)) return;
            // Logged out (or a fresh install) Discord has nothing saved here yet. Reading into the
            // missing value threw inside Discord's own loading and left it on its logo for good.
            if (!ret?._state) return;

            const state = findInTree(ret._state, s => typeof s?.theme === "string");
            if (state) state.theme = _colorRef.key;
        }),
        before("set", mmkvStorage, ([key, value]) => {
            if (!patchedKeys.has(key)) return;

            const json = JSON.stringify(value);
            // Only touch what Discord saves when it actually holds a Deltacord theme name.
            if (typeof json !== "string" || !json.includes('"theme":"bn-theme-')) return;
            const lastSetDiscordTheme = _colorRef.lastSetDiscordTheme ?? "darker";
            const replaced = json.replace(
                /"theme":"bn-theme-\d+"/,
                `"theme":${JSON.stringify(lastSetDiscordTheme)}`
            );

            return [key, JSON.parse(replaced)];
        })
    ];

    return () => patches.forEach(p => p());
}
