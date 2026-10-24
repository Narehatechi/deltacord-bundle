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
});

/**
 * @internal
 */
export function defineCorePlugin(instance: PluginInstanceInternal): PluginInstanceInternal {
    // @ts-expect-error
    instance[Symbol.for("bunny.core.plugin")] = true;
    return instance;
}
