/**
 * The link with Deltacord Manager. The Manager can show Deltacord's health, plugins, themes and
 * backups, and change them, without root: requests reach Deltacord through the module (which
 * only accepts them from the Manager), and answers go back the same way.
 *
 * Requests: { id, action: "status" | "plugin" | "theme" | "backup" | "safemode", target?, value? }.
 * Every request is answered with the full status (plus `error` if it failed).
 */
import { disablePlugin, enablePlugin, isCorePlugin, isPluginEnabled, pluginInstances, registeredPlugins } from "@lib/addons/plugins";
import { getCurrentTheme, selectTheme, themes } from "@lib/addons/themes";
import { getDebugInfo } from "@lib/api/debug";
import { callNative, hasNativeBridge } from "@lib/api/native/bridge";
import { settings } from "@lib/api/settings";

interface Request { id: string; action: string; target?: string | null; value?: boolean | null; }

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** The last Doctor checks, so a status can be sent quickly while new ones run. */
let lastChecks: any[] = [];

async function checks(budgetMs: number) {
    const run = (async () => {
        const { runChecks } = require("./DoctorPage");
        lastChecks = (await runChecks()).map((c: any) => ({ group: c.group, label: c.label, value: String(c.value), status: c.status, hint: c.hint ?? null }));
        return lastChecks;
    })().catch(() => lastChecks);
    return Promise.race([run, sleep(budgetMs).then(() => lastChecks)]);
}

/**
 * While Discord's screen hasn't come up (stuck on its logo), how far startup got: the Manager
 * shows these, so a stuck phone can still say where it stopped.
 */
function startupChecks(): any[] {
    try {
        const { currentStartup, unfinishedSteps } = require("./breadcrumbs");
        const rec = currentStartup();
        if (!rec || rec.uiReady) return [];
        const group = "Startup";
        const out: any[] = [{
            group, label: "Discord's screen",
            value: `not up after ${Math.round((Date.now() - rec.startedAt) / 1000)}s (Deltacord ${rec.opened ? "let Discord open" : "still starting"}, plugins ${rec.ready ? "started" : "not started"})`,
            status: "bad",
        }];
        out.push({ group, label: "Last steps", value: rec.stages.slice(-6).map((st: any) => `${st.name} @${st.ms}ms`).join(" › ") || "none", status: "warn" });
        const unfinished = unfinishedSteps(rec);
        if (unfinished.length) out.push({ group, label: "Never finished", value: unfinished.join(", "), status: "warn" });
        for (const e of (rec.errors ?? []).slice(-3)) out.push({ group, label: "Error", value: String(e).slice(0, 300), status: "bad" });
        try {
            const { findByStoreName } = require("@metro/wrappers");
            const gateway = findByStoreName("GatewayConnectionStore");
            const auth = findByStoreName("AuthenticationStore");
            out.push({
                group, label: "Connection",
                value: `logged in: ${!!auth?.getId?.()} · connected: ${gateway?.isConnected?.() ?? "?"}`,
                status: gateway?.isConnected?.() ? "info" : "warn",
            });
        } catch { }
        return out;
    } catch {
        return [];
    }
}

async function status(requestId: string | null, error?: string) {
    const info = getDebugInfo();
    const { listLocalBackups } = require("./backup");
    const backups = await listLocalBackups().catch(() => []);
    const name = (id: string) => require("@core/plugins").pluginName(registeredPlugins.get(id), id);
    return {
        v: 1,
        requestId,
        error: error ?? null,
        at: Date.now(),
        bundle: String(info.bunny.version),
        module: `${info.bunny.loader.name ?? "?"} ${info.bunny.loader.version ?? ""}`.trim(),
        discord: `${info.discord.version} (${info.discord.build})`,
        safeMode: settings.safeMode?.enabled === true,
        checks: [...startupChecks(), ...await checks(3000)],
        plugins: [...registeredPlugins.keys()]
            // Revenge's own internal plugins aren't shown.
            .filter(id => !id.startsWith("bunny."))
            .map(id => ({ id, name: name(id), on: isPluginEnabled(id), core: isCorePlugin(id), running: pluginInstances.has(id) })),
        themes: Object.values(themes).map(t => ({ id: t.id, name: t.data?.name ?? t.id, on: getCurrentTheme()?.id === t.id })),
        backups: { newest: backups[0]?.createdAt ?? null, count: backups.length },
    };
}

async function send(requestId: string | null, error?: string) {
    const body = await status(requestId, error);
    await callNative("deltacord.manager.status", requestId ?? "", JSON.stringify(body));
}

async function handle(request: Request) {
    let error: string | undefined;
    let after: (() => void) | undefined;
    try {
        switch (request.action) {
            case "status":
                break;
            case "plugin": {
                const id = String(request.target ?? "");
                if (!registeredPlugins.has(id)) throw new Error("That plugin isn't installed.");
                if (request.value) await enablePlugin(id, true);
                else disablePlugin(id);
                break;
            }
            case "theme": {
                const theme = request.target ? themes[request.target] : null;
                if (request.target && !theme) throw new Error("That theme isn't installed.");
                await selectTheme(theme ?? null);
                break;
            }
            case "backup": {
                const { createBackup, saveLocalBackup } = require("./backup");
                await saveLocalBackup(await createBackup({ includeLogs: true }));
                break;
            }
            case "safemode": {
                const { toggleSafeMode } = require("@core/debug/safeMode");
                // Answer first: switching restarts Deltacord.
                after = () => void toggleSafeMode({ to: request.value === true });
                break;
            }
            default:
                throw new Error(`Deltacord doesn't know "${request.action}" (update it?)`);
        }
    } catch (e: any) {
        error = String(e?.message ?? e);
    }
    await send(request.id, error);
    after?.();
}

let running = false;

/** Starts listening for the Manager (Android only; the module carries the requests). */
export function startManagerLink() {
    if (running || !hasNativeBridge()) return;
    running = true;
    void (async () => {
        let failures = 0;
        while (running) {
            try {
                const raw = await callNative("deltacord.manager.next");
                failures = 0;
                if (typeof raw !== "string" || !raw) continue;
                let request: Request;
                try {
                    request = JSON.parse(raw);
                } catch {
                    continue;
                }
                await handle(request);
            } catch (e) {
                // An older module without the link: stop after a few tries.
                if (++failures >= 3) {
                    console.warn("[Deltacord] Manager link unavailable", e);
                    running = false;
                    return;
                }
                await sleep(10_000);
            }
        }
    })();
}
