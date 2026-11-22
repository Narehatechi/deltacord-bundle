/**
 * Tells you when a newer Deltacord module is out (the part built into the app, which only
 * Deltacord Manager can update) and opens the Manager straight into the update.
 */
import { createMMKVBackend, createStorage, wrapSync } from "@core/vendetta/storage";
import { getLoaderVersion, isPyonLoader } from "@lib/api/native/loader";
import { openAlert } from "@lib/ui/alerts";
import { safeFetch } from "@lib/utils";
import { AlertActionButton, AlertActions, AlertModal } from "@metro/common/components";
import { Linking, Platform } from "react-native";

const RELEASES = "https://api.github.com/repos/Narehatechi/deltacord-xposed/releases/latest";

const seen = wrapSync(createStorage<{ skipped?: string; }>(createMMKVBackend("DELTACORD_MODULE_UPDATE")));

/** "1.25.0" > "1.23.1". */
function newer(a: string, b: string): boolean {
    const pa = a.split(".").map(n => parseInt(n, 10) || 0);
    const pb = b.split(".").map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
    }
    return false;
}

/** What's known about the module (for Doctor). */
export const moduleUpdateStatus = { installed: null as string | null, latest: null as string | null };

/** Opens Deltacord Manager to update the module. */
export async function openManagerUpdate() {
    try {
        await (Linking as any).sendIntent("app.deltacord.actions.UPDATE_MODULE");
    } catch {
        // An older Manager: just open it (its main menu offers the update).
        await Linking.openURL("https://github.com/Narehatechi/deltacord-manager/releases/latest").catch(() => { });
    }
}

/** Checks GitHub once per launch; asks once per new module (Later skips that one). */
export async function checkModuleUpdate() {
    if (Platform.OS !== "android" || !isPyonLoader()) return;
    const installed = getLoaderVersion()?.replace(/^\D+/, "") ?? null;
    moduleUpdateStatus.installed = installed;
    if (!installed) return;
    const release = await (await safeFetch(RELEASES, { cache: "no-store" })).json();
    const latest = String(release?.name ?? "").trim();
    moduleUpdateStatus.latest = latest || null;
    if (!/^\d+\.\d+\.\d+$/.test(latest) || !newer(latest, installed) || seen.skipped === latest) return;

    openAlert("deltacord-module-update", <AlertModal
        title="A new Deltacord module is ready"
        content={`Module ${latest} is out (you have ${installed}). Deltacord Manager updates it in a moment; your settings, plugins and themes stay.`}
        actions={<AlertActions>
            <AlertActionButton text="Update now" variant="primary" onPress={() => void openManagerUpdate()} />
            <AlertActionButton text="Later" variant="secondary" onPress={() => { seen.skipped = latest; }} />
        </AlertActions>}
    />);
}
