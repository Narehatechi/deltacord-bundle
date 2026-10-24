/**
 * Deltacord's own startup work, around Bunny's:
 * - initDeltacordEarly(): first thing (crash-loop guard, extras),
 * - initDeltacordLate(): once plugins are up (crash notice, automatic backup).
 */
import { openAlert } from "@lib/ui/alerts";
import { showToast } from "@lib/ui/toasts";
import { findAssetId } from "@lib/api/assets";
import { clipboard } from "@metro/common";
import { AlertActionButton, AlertActions, AlertModal } from "@metro/common/components";
import { BundleUpdaterManager } from "@lib/api/native/modules";
import { settings } from "@lib/api/settings";

import { autoBackupIfDue } from "./backup";
import { disableSuspect, initCrashGuard, takeCrashNotice } from "./crashguard";
import { culpritFoundNow, FEATURE_NAMES, FEATURES, isFeatureOn, markReady, stuckLastTime, stuckReportText } from "./breadcrumbs";
import { initExtras } from "./extras";
import { markGuardDecided, startingInSafeMode } from "./safeModeGate";
import { ensureThemeFontAtStartup } from "./themeFont";
import { getCurrentTheme } from "@lib/addons/themes";

export async function initDeltacordEarly() {
    try {
        if (isFeatureOn("crashguard")) await initCrashGuard();
        else markGuardDecided();
    } catch (e) {
        console.error("[Deltacord] Crash guard failed to start", e);
    }
    try {
        // Safe Mode: none of the extras either.
        if (!isFeatureOn("extras") || await startingInSafeMode()) return;
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

function explainStuckLaunch() {
    const found = culpritFoundNow();
    const off = FEATURES.filter(f => !isFeatureOn(f)).map(f => FEATURE_NAMES[f]);
    const copy = async () => {
        try {
            clipboard.setString(await stuckReportText());
            showToast("Report copied", findAssetId("CopyIcon"));
        } catch { }
    };
    const content = found
        ? `Found it: "${FEATURE_NAMES[found]}" got Discord stuck while starting, so it's off for now and everything else is back on. Copy the report and send it so it can be fixed; the fix will turn it back on.`
        : `Discord got stuck while starting last time, so this launch started with some of Deltacord off (${off.join(", ")}). Deltacord turns them back on one per launch to find the one causing it; just keep using Discord.\n\nCopy the report and send it so it can be fixed.`;
    openAlert(
        "deltacord-stuck-launch",
        <AlertModal
            title={found ? "Found what got stuck" : "Last launch got stuck"}
            content={content}
            actions={<AlertActions>
                <AlertActionButton text="Copy report" variant="primary" onPress={() => void copy()} />
                <AlertActionButton text="OK" variant="secondary" />
            </AlertActions>}
        />
    );
}

export function initDeltacordLate() {
    markReady();
    if (stuckLastTime() || culpritFoundNow()) setTimeout(explainStuckLaunch, 1500);
    if (isFeatureOn("crashguard")) showCrashNotice().catch(e => console.error("[Deltacord] Crash notice failed", e));
    // Give Deltacord's themes their font (not during Safe Mode, when the theme is off anyway).
    if (isFeatureOn("fontsync") && isFeatureOn("theme") && !settings.safeMode?.enabled) ensureThemeFontAtStartup(getCurrentTheme()?.id);
    // A quiet safety net, well after startup so it never slows Discord down.
    setTimeout(() => void autoBackupIfDue(), 90_000);
}
