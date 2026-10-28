import { VdPluginManager, VendettaPlugin } from "@core/vendetta/plugins";
import { useProxy } from "@core/vendetta/storage";
import { UnifiedPluginModel } from ".";
import { showToast } from "@lib/ui/toasts";
import { findAssetId } from "@lib/api/assets";

export default function unifyVdPlugin(vdPlugin: VendettaPlugin): UnifiedPluginModel {
    return {
        id: vdPlugin.id,
        name: vdPlugin.manifest.name,
        description: vdPlugin.manifest.description,
        authors: vdPlugin.manifest.authors,
        icon: vdPlugin.manifest.vendetta?.icon,

        getBadges() {
            return [];
        },
        isEnabled: () => vdPlugin.enabled,
        isInstalled: () => Boolean(vdPlugin && VdPluginManager.plugins[vdPlugin.id]),
        usePluginState() {
            useProxy(VdPluginManager.plugins[vdPlugin.id]);
        },
        toggle(start: boolean) {
            Promise.resolve(start
                ? VdPluginManager.startPlugin(vdPlugin.id)
                : VdPluginManager.stopPlugin(vdPlugin.id))
                // Show the change in the open chat right away.
                .finally(() => require("@core/deltacord/refresh").refreshChat());
        },
        resolveSheetComponent() {
            return import("../sheets/VdPluginInfoActionSheet");
        },
        getPluginSettingsComponent() {
            return VdPluginManager.getSettings(vdPlugin.id);
        },
    };
}
