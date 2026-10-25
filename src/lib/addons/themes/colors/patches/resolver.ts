import { _colorRef } from "@lib/addons/themes/colors/updater";
import { NativeThemeModule } from "@lib/api/native/modules";
import { before, instead } from "@lib/api/patcher";
import { findByProps } from "@metro";
import { byMutableProp } from "@metro/filters";
import { createLazyModule } from "@metro/lazy";
import chroma from "chroma-js";

const tokenReference = findByProps("SemanticColor");
/** Discord's own theme names (the ones it can switch an area to). */
const THEME_NAMES = ["light", "dark", "darker", "midnight", "amoled"];
const isThemeModule = createLazyModule(byMutableProp("isThemeDark"));

const SEMANTIC_FALLBACK_MAP: Record<string, string> = {
    "BG_BACKDROP": "BACKGROUND_FLOATING",
    "BG_BASE_PRIMARY": "BACKGROUND_PRIMARY",
    "BG_BASE_SECONDARY": "BACKGROUND_SECONDARY",
    "BG_BASE_TERTIARY": "BACKGROUND_SECONDARY_ALT",
    "BG_MOD_FAINT": "BACKGROUND_MODIFIER_ACCENT",
    "BG_MOD_STRONG": "BACKGROUND_MODIFIER_ACCENT",
    "BG_MOD_SUBTLE": "BACKGROUND_MODIFIER_ACCENT",
    "BG_SURFACE_OVERLAY": "BACKGROUND_FLOATING",
    "BG_SURFACE_OVERLAY_TMP": "BACKGROUND_FLOATING",
    "BG_SURFACE_RAISED": "BACKGROUND_MOBILE_PRIMARY"
};

export default function patchDefinitionAndResolver() {
    // Discord draws some areas in another theme on purpose: a profile with bright theme colours
    // (an orange banner, say) gets the light theme. With a Deltacord theme on, those areas mixed
    // the light theme's dark text with the theme's dark cards, so text vanished. While a theme is
    // on, every area uses it.
    const isOurs = (theme: any) => !!_colorRef.current && (theme === _colorRef.key || typeof theme === "string" && THEME_NAMES.includes(theme));
    const callback = ([theme]: any[]) => isOurs(theme) ? [_colorRef.current!.reference] : void 0;

    // What Discord's native side is told when a Deltacord theme is applied. A different native theme
    // makes Discord recreate its screen (on Android), which left it stuck on its launch logo. So if
    // Discord is already on a theme of the same kind (any dark one for a dark theme), keep that one.
    const DARK = ["dark", "darker", "midnight", "amoled"];
    const nativeCallback = ([theme]: any[]) => {
        if (theme !== _colorRef.key || !_colorRef.current) return void 0;
        const wanted = _colorRef.current.reference;
        const current = _colorRef.lastSetDiscordTheme;
        const sameKind = (DARK.includes(wanted) && DARK.includes(current)) || (wanted === "light" && current === "light");
        return [sameKind && current ? current : wanted];
    };

    Object.keys(tokenReference.RawColor).forEach(key => {
        Object.defineProperty(tokenReference.RawColor, key, {
            configurable: true,
            enumerable: true,
            get: () => {
                const ret = _colorRef.current?.raw[key];
                return ret || _colorRef.origRaw[key];
            }
        });
    });

    const unpatches = [
        before("isThemeDark", isThemeModule, callback),
        before("isThemeLight", isThemeModule, callback),
        before("updateTheme", NativeThemeModule, nativeCallback),
        instead("resolveSemanticColor", tokenReference.default.meta ?? tokenReference.default.internal, (args: any[], orig: any) => {
            if (!_colorRef.current) return orig(...args);
            if (!isOurs(args[0])) return orig(...args);

            args[0] = _colorRef.current.reference;

            const [name, colorDef] = extractInfo(_colorRef.current!.reference, args[1]);

            let semanticDef = _colorRef.current.semantic[name];
            if (!semanticDef && _colorRef.current.spec === 2 && name in SEMANTIC_FALLBACK_MAP) {
                semanticDef = _colorRef.current.semantic[SEMANTIC_FALLBACK_MAP[name]];
            }

            if (semanticDef?.value) {
                if (semanticDef.opacity === 1) return semanticDef.value;
                return chroma(semanticDef.value).alpha(semanticDef.opacity).hex();
            }

            const rawValue = _colorRef.current.raw[colorDef.raw];
            if (rawValue) {
                // Set opacity if needed
                return colorDef.opacity === 1 ? rawValue : chroma(rawValue).alpha(colorDef.opacity).hex();
            }

            // Fallback to default
            return orig(...args);
        }),
        () => {
            // Not the actual module but.. yeah.
            Object.defineProperty(tokenReference, "RawColor", {
                configurable: true,
                writable: true,
                value: _colorRef.origRaw
            });
        }
    ];

    return () => unpatches.forEach(p => p());
}

function extractInfo(themeName: string, colorObj: any): [name: string, colorDef: any] {
    // @ts-ignore - assigning to extractInfo._sym
    const propName = colorObj[extractInfo._sym ??= Object.getOwnPropertySymbols(colorObj)[0]];
    const colorDef = tokenReference.SemanticColor[propName];

    return [propName, colorDef[themeName]];
}
