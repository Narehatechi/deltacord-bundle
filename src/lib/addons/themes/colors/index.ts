
import patchChatBackground from "./patches/background";
import patchDefinitionAndResolver from "./patches/resolver";
import patchStorage from "./patches/storage";
import { ColorManifest } from "./types";
import { updateBunnyColor } from "./updater";

/** @internal */
export default function initColors(manifest: ColorManifest | null, debug = { storage: true, resolver: true }) {
    const patches = [
        debug.storage ? patchStorage() : () => { },
        debug.resolver ? patchDefinitionAndResolver() : () => { },
        patchChatBackground()
    ];

    if (manifest) updateBunnyColor(manifest, { update: false });

    return () => patches.forEach(p => p());
}
