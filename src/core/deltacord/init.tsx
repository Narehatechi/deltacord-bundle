/**
 * Deltacord's own startup work, around Bunny's:
 * - initDeltacordEarly(): first thing (crash-loop guard, extras),
 * - initDeltacordLate(): once plugins are up (crash notice, automatic backup).
 */
import { openAlert } from "@lib/ui/alerts";
import { AlertActionButton, AlertActions, AlertModal } from "@metro/common/components";
import { BundleUpdaterManager } from "@lib/api/native/modules";
import { settings } from "@lib/api/settings";

import { autoBackupIfDue } from "./backup";
import { disableSuspect, initCrashGuard, takeCrashNotice } from "./crashguard";
import { isMinimalStartup, leaveMinimalStartup, markReady, unfinishedSteps } from "./breadcrumbs";
import { initExtras } from "./extras";
import { startingInSafeMode } from "./safeModeGate";
import { ensureThemeFontAtStartup } from "./themeFont";
import { getCurrentTheme } from "@lib/addons/themes";

export async function initDeltacordEarly() {
    try {
        await initCrashGuard();
    } catch (e) {
        console.error("[Deltacord] Crash guard failed to start", e);
    }
    try {
        // Safe Mode: none of the extras either.
        if (await startingInSafeMode()) return;
        return initExtras();
    } catch (e) {
        console.error("[Deltacord] Extras failed to start", e);
    }
}

function leaveSafeMode() {
    settings.safeMode = { ...settings.safeMode, enabled: false };
    setTimeout(() => BundleUpdaterManager.reload(), 400);
}

async function showCrashNotice() {
    const notice = await takeCrashNotice();
    if (!notice) return;
    const suspect = notice.lastCrash?.suspect;

    if (notice.autoSafeMode) {
        openAlert(
            "deltacord-auto-safe-mode",
            <AlertModal
                title="Started in Safe Mode"
                content={`Deltacord closed or got stuck twice in a row while opening, so plugins and Deltacord's extras are switched off for now.${suspect ? `\n\nIt looks like the plugin "${suspect.name}" caused it.` : ""}`}
                actions={<AlertActions>
                    {suspect && <AlertActionButton
                        text={`Turn off "${suspect.name}" and restart`}
                        variant="primary"
                        onPress={() => {
                            disableSuspect(suspect);
                            leaveSafeMode();
                        }}
                    />}
                    <AlertActionButton text="Restart normally" variant="secondary" onPress={leaveSafeMode} />
                    <AlertActionButton text="Stay in Safe Mode" variant="secondary" />
                </AlertActions>}
            />
        );
    } else if (suspect) {
        openAlert(
            "deltacord-crash-suspect",
            <AlertModal
                title="Discord closed unexpectedly"
                content={`Last time, the plugin "${suspect.name}" crashed it. Turn that plugin off?`}
                actions={<AlertActions>
                    <AlertActionButton text="Turn it off" variant="destructive" onPress={() => disableSuspect(suspect)} />
                    <AlertActionButton text="Keep it" variant="secondary" />
                </AlertActions>}
            />
        );
    }
}

function explainMinimalStartup() {
    const stuck = unfinishedSteps();
    openAlert(
        "deltacord-minimal-startup",
        <AlertModal
            title="Started without Deltacord's extras"
            content={`The last launch got stuck${stuck.length ? ` (it never finished: ${stuck.join(", ")})` : ""}, so Deltacord started without its own additions (theme setup, Message Logger, Tweaks and extras) and Discord could open.\n\nDeltacord > Doctor has the details for a report. You can try the full startup again whenever you like.`}
            actions={<AlertActions>
                <AlertActionButton text="Try full startup again" variant="primary" onPress={() => {
                    void leaveMinimalStartup().then(() => setTimeout(() => BundleUpdaterManager.reload(), 300));
                }} />
                <AlertActionButton text="Stay like this for now" variant="secondary" />
            </AlertActions>}
        />
    );
}

export function initDeltacordLate() {
    markReady();
    if (isMinimalStartup()) {
        setTimeout(explainMinimalStartup, 1500);
        return;
    }
    showCrashNotice().catch(e => console.error("[Deltacord] Crash notice failed", e));
    // Give Deltacord's themes their font (not during Safe Mode, when the theme is off anyway).
    if (!settings.safeMode?.enabled) ensureThemeFontAtStartup(getCurrentTheme()?.id);
    // A quiet safety net, well after startup so it never slows Discord down.
    setTimeout(() => void autoBackupIfDue(), 90_000);
}
