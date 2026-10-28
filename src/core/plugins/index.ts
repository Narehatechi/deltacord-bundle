import { PluginInstanceInternal } from "@lib/addons/plugins/types";

interface CorePlugin {
    default: PluginInstanceInternal;
    preenabled: boolean;
}

// Called from @lib/plugins
export const getCorePlugins = (): Record<string, CorePlugin> => ({
    "bunny.quickinstall": require("./quickinstall"),
    "bunny.badges": require("./badges"),
    "deltacord.messagelogger": require("./messagelogger"),
    "deltacord.tweaks": require("./tweaks"),
    "deltacord.hiddenchannels": require("./hiddenchannels"),
    "deltacord.cleanlinks": require("./cleanlinks"),
    "deltacord.betterembeds": require("./betterembeds"),
    "deltacord.noreplyping": require("./noreplyping"),
    "deltacord.hideblocked": require("./hideblocked"),
    "deltacord.alwaystrust": require("./alwaystrust"),
    "deltacord.freeemojis": require("./freeemojis"),
    "deltacord.funcommands": require("./funcommands"),
    "deltacord.fancytext": require("./fancytext"),
    "deltacord.translate": require("./translate"),
    "deltacord.dictionary": require("./dictionary"),
    "deltacord.calculator": require("./calculator"),
    "deltacord.reminders": require("./reminders"),
    "deltacord.keywords": require("./keywords"),
    "deltacord.textreplace": require("./textreplace"),
    "deltacord.typewriter": require("./typewriter"),
});

/** A built-in plugin's manifest (simpler than an installed plugin's). */
export interface CorePluginManifest {
    readonly id: string;
    readonly name: string;
    readonly version: string;
    readonly description?: string;
    readonly authors?: Array<{ name: string; id?: string; }>;
}

/** A plugin's name, whichever kind of manifest it has. */
export const pluginName = (manifest: any, fallback = "") =>
    manifest?.name ?? manifest?.display?.name ?? fallback;

/**
 * @internal
 */
export function defineCorePlugin(plugin: Omit<PluginInstanceInternal, "manifest"> & { manifest: CorePluginManifest; }): PluginInstanceInternal {
    const instance = plugin as unknown as PluginInstanceInternal;
    // @ts-expect-error
    instance[Symbol.for("bunny.core.plugin")] = true;
    return instance;
}
