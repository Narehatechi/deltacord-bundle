import patchErrorBoundary from "@core/debug/patches/patchErrorBoundary";
import initFixes from "@core/fixes";
import { initFetchI18nStrings } from "@core/i18n";
import { markDiscordStarting } from "@core/deltacord/crashguard";
import { initDeltacordEarly, initDeltacordLate } from "@core/deltacord/init";
import { guardStep } from "@core/deltacord/startup";
import { startMessageLoggerEarly } from "@core/plugins/messagelogger";
import initSettings from "@core/ui/settings";
import { initVendettaObject } from "@core/vendetta/api";
import { VdPluginManager } from "@core/vendetta/plugins";
import { updateFonts } from "@lib/addons/fonts";
import { initPlugins, updatePlugins } from "@lib/addons/plugins";
import { initThemes } from "@lib/addons/themes";
import { patchCommands } from "@lib/api/commands";
import { initDebugger } from "@lib/api/debug";
import { injectFluxInterceptor } from "@lib/api/flux";
import { patchJsx } from "@lib/api/react/jsx";
import { logger } from "@lib/utils/logger";
import { patchSettings } from "@ui/settings";

import * as lib from "./lib";

export default async () => {
    // Load everything in parallel. Discord waits for all of this, so each step has a time limit:
    // one that never finishes is left behind and Discord opens anyway (see core/deltacord/startup).
    // Plugins start once their update check is done, even if Discord had to open before it was.
    let pluginUpdates: Promise<unknown> = Promise.resolve();

    const crumbs = require("@core/deltacord/breadcrumbs");
    const step = <T>(name: string, run: () => Promise<T> | T) => {
        let work: Promise<T> | T;
        crumbs.stage(`start: ${name}`, { quiet: true });
        try {
            work = run();
        } catch (e) {
            work = Promise.reject(e);
        }
        return guardStep(name, work).finally(() => crumbs.stage(`done: ${name}`, { quiet: true }));
    };

    await Promise.all([
        step("Deltacord", initDeltacordEarly),
        step("Themes", initThemes),
        step("Flux", injectFluxInterceptor),
        step("Message Logger", startMessageLoggerEarly),
        step("Settings patches", patchSettings),
        step("Commands", patchCommands),
        step("JSX", patchJsx),
        step("Vendetta API", initVendettaObject),
        step("Translations", initFetchI18nStrings),
        step("Settings", initSettings),
        step("Fixes", initFixes),
        step("Error screen", patchErrorBoundary),
        step("Plugin updates", () => (pluginUpdates = updatePlugins())),
    ]).then(
        // Push them all to unloader
        u => u.forEach(f => typeof f === "function" && lib.unload.push(f as () => void))
    );

    // Discord opens as soon as this function returns.
    markDiscordStarting();

    // Assign window object
    window.bunny = lib;

    // Start debugger
    initDebugger();

    // Once done, load Vendetta plugins
    VdPluginManager.initPlugins()
        .then(u => lib.unload.push(u))
        .catch(() => alert("Failed to initialize Vendetta plugins"));

    // And then, load Bunny plugins, then Deltacord's after-startup work
    pluginUpdates
        .catch(() => { })
        .then(() => initPlugins())
        .catch(e => console.error("[Deltacord] Plugins failed to start", e))
        .finally(() => initDeltacordLate());

    // Update the fonts
    updateFonts();

    // We good :)
    logger.log("Deltacord is ready!");
};
