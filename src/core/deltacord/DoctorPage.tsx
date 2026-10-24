/**
 * Doctor: one tap checks everything that commonly goes wrong and produces a report
 * that can be copied and sent, turning "it's broken" into something fixable.
 */
import { getCrashGuardState } from "@core/deltacord/crashguard";
import { isLoggerRunning } from "@core/plugins/messagelogger";
import { counts as loggerCounts } from "@core/plugins/messagelogger/store";
import { runningTweaks } from "@core/plugins/tweaks";
import { VdPluginManager } from "@core/vendetta/plugins";
import { fonts } from "@lib/addons/fonts";
import { isCorePlugin, pluginInstances, pluginSettings, registeredPlugins } from "@lib/addons/plugins";
import { getCurrentTheme, themes } from "@lib/addons/themes";
import { BUILTIN_THEME_IDS } from "@lib/addons/themes/builtin/deltarune";
import { findAssetId } from "@lib/api/assets";
import { getDebugInfo } from "@lib/api/debug";
import { isThemeSupported } from "@lib/api/native/loader";
import { settings } from "@lib/api/settings";
import { showToast } from "@lib/ui/toasts";
import { clipboard } from "@metro/common";
import { Button, Stack, TableRow, TableRowGroup, Text } from "@metro/common/components";
import { useEffect, useState } from "react";
import { ScrollView } from "react-native";

import { listLocalBackups } from "./backup";
import { failedSteps, slowSteps, stepTimes } from "./startup";
import { FEATURE_NAMES, FEATURES, featureState, getStuckLaunch, isFeatureOn, isMinimalStartup, previousStartup, stuckReportText, unfinishedSteps } from "./breadcrumbs";

type Status = "ok" | "warn" | "bad" | "info";

interface Check {
    group: string;
    label: string;
    value: string;
    status: Status;
    hint?: string;
}

const REPO = "Narehatechi/deltacord-bundle";
const MARK: Record<Status, string> = { ok: "✓", warn: "!", bad: "✗", info: "·" };

async function getJson(url: string, timeoutMs = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { signal: controller.signal, headers: { Accept: "application/vnd.github+json" } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    } finally {
        clearTimeout(timer);
    }
}

const ago = (ms: number) => {
    const m = Math.round((Date.now() - ms) / 60000);
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
};

async function runChecks(): Promise<Check[]> {
    const checks: Check[] = [];
    const add = (c: Check) => checks.push(c);
    const safe = async (group: string, label: string, fn: () => Promise<void> | void) => {
        try {
            await fn();
        } catch (e: any) {
            add({ group, label, value: `check failed: ${e?.message ?? e}`, status: "warn" });
        }
    };

    const info = getDebugInfo();
    const bundleHash = String(info.bunny.version).split("-")[0];

    await safe("Versions", "Versions", () => {
        add({ group: "Versions", label: "Deltacord", value: String(info.bunny.version), status: "info" });
        add({ group: "Versions", label: "Module", value: `${info.bunny.loader.name} ${info.bunny.loader.version}`, status: "info" });
        add({ group: "Versions", label: "Discord", value: `${info.discord.version} (${info.discord.build})`, status: "info" });
        add({ group: "Versions", label: "Device", value: `${info.os.name} ${info.os.version ?? ""} · ${info.device?.manufacturer ?? ""} ${info.device?.model ?? ""}`.trim(), status: "info" });
    });

    await safe("Updates", "Latest Deltacord", async () => {
        const release = await getJson(`https://api.github.com/repos/${REPO}/releases/latest`);
        add({ group: "Updates", label: "GitHub", value: "reachable", status: "ok" });
        let upToDate: boolean | undefined;
        try {
            const ref = await getJson(`https://api.github.com/repos/${REPO}/git/ref/tags/${release.tag_name}`);
            const commit = await getJson(`https://api.github.com/repos/${REPO}/git/commits/${ref.object.sha}`);
            const candidates = [commit.sha, ...(commit.parents ?? []).map((p: any) => p.sha)];
            upToDate = candidates.some((sha: string) => sha.startsWith(bundleHash));
        } catch { }
        add({
            group: "Updates",
            label: "Latest Deltacord",
            value: `${release.tag_name}${upToDate === true ? " (you have it)" : upToDate === false ? " (newer than yours)" : ""}`,
            status: upToDate === false ? "warn" : "ok",
            hint: upToDate === false ? "Fully close and reopen Discord to get it." : undefined,
        });
    });

    await safe("Theme", "Theme", () => {
        const supported = isThemeSupported();
        add({ group: "Theme", label: "Theme support", value: supported ? "yes" : "no", status: supported ? "ok" : "bad", hint: supported ? undefined : "Reinstall Deltacord from the installer." });
        add({ group: "Theme", label: "Current theme", value: getCurrentTheme()?.data?.name ?? "none", status: "info" });
        const builtins = BUILTIN_THEME_IDS.filter(id => themes[id]).length;
        add({ group: "Theme", label: "Built-in themes", value: `${builtins} of ${BUILTIN_THEME_IDS.length} installed`, status: "info" });
        add({ group: "Theme", label: "Font", value: (fonts as any).__selected ?? "Discord's default", status: "info" });
    });

    await safe("Plugins", "Plugins", () => {
        const safeMode = settings.safeMode?.enabled === true;
        add({ group: "Plugins", label: "Safe Mode", value: safeMode ? "on (plugins and Deltacord's extras are off)" : "off", status: safeMode ? "warn" : "ok", hint: safeMode ? "Turn it off in Deltacord's settings when you're ready." : undefined });

        const ids = [...registeredPlugins.keys()];
        const enabled = ids.filter(id => pluginSettings[id]?.enabled);
        const notRunning = enabled.filter(id => !pluginInstances.has(id) && (!safeMode || (isCorePlugin(id) && !id.startsWith("deltacord."))));
        add({ group: "Plugins", label: "Plugins", value: `${enabled.length} on, ${pluginInstances.size} running`, status: notRunning.length ? "warn" : "ok" });
        for (const id of notRunning) {
            add({ group: "Plugins", label: registeredPlugins.get(id)?.name ?? id, value: "on but not running", status: "warn", hint: "It may have failed to start; try turning it off and on." });
        }

        const vd = Object.values<any>(VdPluginManager.plugins ?? {});
        const vdOn = vd.filter(p => p.enabled);
        if (vd.length) add({ group: "Plugins", label: "Vendetta plugins", value: `${vdOn.length} of ${vd.length} on`, status: "info" });
    });

    await safe("Deltacord", "Features", async () => {
        const c = loggerCounts();
        add({ group: "Deltacord", label: "Message logger", value: isLoggerRunning() ? `running · ${c.deleted} deleted, ${c.edited} edited` : "off", status: "info" });
        const tweaks = runningTweaks();
        add({ group: "Deltacord", label: "Tweaks", value: tweaks.length ? tweaks.join(", ") : "none on", status: "info" });

        const newest = (await listLocalBackups())[0];
        add({
            group: "Deltacord",
            label: "Newest backup",
            value: newest ? ago(newest.createdAt) : "none yet",
            status: newest ? "ok" : "warn",
            hint: newest ? undefined : "Make one in Backup & restore.",
        });

        const slowest = Object.entries(stepTimes).sort(([, a], [, b]) => b - a)[0];
        add({
            group: "Deltacord",
            label: "Startup",
            value: [
                failedSteps.length && `failed: ${failedSteps.join(", ")}`,
                slowSteps.length && `slow: ${slowSteps.join(", ")} (Discord opened without waiting)`,
            ].filter(Boolean).join(" · ") || (slowest ? `ok · slowest step ${slowest[0]} (${(slowest[1] / 1000).toFixed(1)}s)` : "ok"),
            status: failedSteps.length || slowSteps.length ? "warn" : "ok",
            hint: failedSteps.length || slowSteps.length ? "Send this report if it keeps happening." : undefined,
        });

        const stuck = getStuckLaunch() ?? (previousStartup()?.opened === false ? previousStartup() : null);
        if (isMinimalStartup()) {
            const fs = featureState();
            const off = FEATURES.filter(f => !isFeatureOn(f)).map(f => FEATURE_NAMES[f]);
            add({
                group: "Deltacord",
                label: "Self-healing",
                value: fs.probing
                    ? `finding what got stuck · off this launch: ${off.join(", ")}`
                    : `off because it got Discord stuck: ${fs.culprits.map(f => FEATURE_NAMES[f]).join(", ")}`,
                status: "warn",
                hint: "Deltacord switches these back on by itself; a fix in a new version turns them back on.",
            });
        }
        if (stuck) {
            const lastStage = stuck.stages[stuck.stages.length - 1]?.name ?? "the very start";
            const unfinished = unfinishedSteps(stuck);
            add({
                group: "Deltacord",
                label: "Stuck launch",
                value: `build ${stuck.version}; last step "${lastStage}"${unfinished.length ? `; never finished: ${unfinished.join(", ")}` : ""}`,
                status: "warn",
                hint: "Send this report so it can be fixed.",
            });
            add({ group: "Deltacord", label: "Stuck launch steps", value: stuck.stages.map(s => `${s.name} @${s.ms}ms`).join(" › "), status: "info" });
        }

        const guard = await getCrashGuardState();
        add({
            group: "Deltacord",
            label: "Last crash",
            value: guard.lastCrash ? `${ago(guard.lastCrash.at)}${guard.lastCrash.suspect ? ` · ${guard.lastCrash.suspect.name}` : ""}` : "none recorded",
            status: guard.lastCrash ? "warn" : "ok",
        });
    });

    return checks;
}

function report(checks: Check[]) {
    const lines = ["Deltacord Doctor report", new Date().toISOString(), ""];
    let group = "";
    for (const c of checks) {
        if (c.group !== group) {
            group = c.group;
            lines.push(`[${group}]`);
        }
        lines.push(`${MARK[c.status]} ${c.label}: ${c.value}${c.hint ? `  (${c.hint})` : ""}`);
    }
    return lines.join("\n");
}

export default function DoctorPage() {
    const [checks, setChecks] = useState<Check[] | null>(null);
    const [running, setRunning] = useState(false);

    const run = async () => {
        setRunning(true);
        try {
            setChecks(await runChecks());
        } finally {
            setRunning(false);
        }
    };
    useEffect(() => void run(), []);

    const groups = checks ? [...new Set(checks.map(c => c.group))] : [];
    const problems = checks?.filter(c => c.status === "warn" || c.status === "bad").length ?? 0;

    return (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 38 }}>
            <Stack style={{ paddingVertical: 24, paddingHorizontal: 12 }} spacing={20}>
                <Text variant="heading-lg/bold">
                    {!checks ? "Checking…" : problems ? `${problems} thing${problems > 1 ? "s" : ""} to look at` : "Everything looks good"}
                </Text>
                <Stack direction="horizontal" spacing={8}>
                    <Button text={running ? "Checking…" : "Check again"} variant="secondary" disabled={running} onPress={run} />
                    <Button
                        text="Copy report"
                        disabled={!checks}
                        onPress={async () => {
                            let stuck = "";
                            try {
                                stuck = "\n\n" + await stuckReportText();
                            } catch { }
                            clipboard.setString(report(checks ?? []) + stuck);
                            showToast("Report copied", findAssetId("CopyIcon"));
                        }}
                    />
                </Stack>
                {groups.map(group => (
                    <TableRowGroup key={group} title={group}>
                        {checks!.filter(c => c.group === group).map((c, i) => (
                            <TableRow
                                key={`${group}-${i}`}
                                label={`${MARK[c.status]}  ${c.label}`}
                                subLabel={c.hint ? `${c.value}\n${c.hint}` : c.value}
                            />
                        ))}
                    </TableRowGroup>
                ))}
            </Stack>
        </ScrollView>
    );
}
