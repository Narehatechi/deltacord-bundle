import { _colorRef } from "@lib/addons/themes/colors/updater";
import { after, before } from "@lib/api/patcher";
import { findInTree } from "@lib/utils";
import { proxyLazy } from "@lib/utils/lazy";
import { findByProps, findByStoreNameLazy } from "@metro";

const mmkvStorage = proxyLazy(() => {
    const newModule = findByProps("impl");
    if (typeof newModule?.impl === "object") return newModule.impl;
    return findByProps("storage");
});

export const storageDebug = { noget: false, noset: false, safe: false, authget: false, log: [] as string[] };
const note = (t: string) => { if (storageDebug.log.length < 14) storageDebug.log.push(t); };
const AuthenticationStore = findByStoreNameLazy("AuthenticationStore");

export default function patchStorage() {
    const patchedKeys = new Set(["ThemeStore", "SelectivelySyncedUserSettingsStore"]);

    const patches = [
        after("get", mmkvStorage, ([key], ret) => {
            if (!_colorRef.current || !patchedKeys.has(key)) return;
            let token: any = "?";
            try { token = !!AuthenticationStore.getToken?.(); } catch (e) { token = "err"; }
            note(`get ${key} ret=${ret == null ? String(ret) : typeof ret} state=${ret?._state == null ? String(ret?._state) : "obj"} token=${token}`);
            if (storageDebug.noget) return;
            if (storageDebug.safe && !ret?._state) return;
            if (storageDebug.authget && token !== true) return;

            const state = findInTree(ret._state, s => typeof s.theme === "string");
            if (state) state.theme = _colorRef.key;
        }),
        before("set", mmkvStorage, ([key, value]) => {
            if (!patchedKeys.has(key)) return;
            note(`set ${key} value=${value == null ? String(value) : typeof value} has=${String(JSON.stringify(value) ?? "").includes("bn-theme-")}`);
            if (storageDebug.noset) return;
            if (storageDebug.safe && !String(JSON.stringify(value) ?? "").includes("bn-theme-")) return;

            const json = JSON.stringify(value);
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
