import { PyoncordIcon } from "@core/ui/settings";
import { disablePlugin, enablePlugin, getPluginSettingsComponent, isPluginEnabled, pluginSettings } from "@lib/addons/plugins";
import { BunnyPluginManifest } from "@lib/addons/plugins/types";
import { useObservable } from "@lib/api/storage";

import { UnifiedPluginModel } from ".";

export default function unifyBunnyPlugin(manifest: BunnyPluginManifest): UnifiedPluginModel {
    return {
        id: manifest.id,
        // Deltacord's built-in plugins keep these at the top level instead of under `display`.
        name: manifest.display?.name ?? (manifest as any).name ?? manifest.id,
        description: manifest.display?.description ?? (manifest as any).description,
        authors: manifest.display?.authors ?? (manifest as any).authors,

        getBadges() {
            return [
                { source: { uri: PyoncordIcon } },
                // { source: findAssetId("CheckmarkLargeBoldIcon")! }
            ];
        },
        isEnabled: () => isPluginEnabled(manifest.id),
        isInstalled: () => manifest.id in pluginSettings,
        usePluginState() {
            useObservable([pluginSettings]);
        },
        toggle(start: boolean) {
            try {
                start
                    ? enablePlugin(manifest.id, true)
                    : disablePlugin(manifest.id);
            } catch (e) {
                console.error(e);
                // showToast("Failed to toggle plugin " + e, findAssetId("XSmallIcon"));
            }
        },
        resolveSheetComponent() {
            return import("../sheets/PluginInfoActionSheet");
        },
        getPluginSettingsComponent() {
            return getPluginSettingsComponent(manifest.id);
        },
    };
}
