/**
 * Doctor's self-test: checks, on this phone and this Discord version, that every part of Discord
 * each built-in plugin relies on can be found, that the plugin is running, and what it has done
 * this session. Turns "a plugin doesn't work" into "this exact piece is missing".
 */
import { hiddenState } from "@core/plugins/hiddenchannels";
import { isLoggerRunning } from "@core/plugins/messagelogger";
import { stats as loggerStats } from "@core/plugins/messagelogger/logger";
import { rowManagerFound, rowsStyledCount } from "@core/plugins/messagelogger/rows";
import { sendStats } from "@core/plugins/shared";
import { cleanLink } from "@core/plugins/cleanlinks";
import { calculate } from "@core/plugins/calculator";
import { STYLES } from "@core/plugins/fancytext";
import { isPluginEnabled, pluginInstances, registeredPlugins } from "@lib/addons/plugins";
import { addedCommandNames } from "@lib/api/commands";
import { fluxStats } from "@lib/api/flux";
import { constants, FluxDispatcher, messageUtil } from "@metro/common";
import { findByName, findByProps, findByStoreName } from "@metro/wrappers";

type Status = "ok" | "warn" | "bad" | "info";
export interface SelfTestCheck { group: string; label: string; value: string; status: Status; hint?: string; }

const fn = (obj: any, key: string) => typeof obj?.[key] === "function";

/** Each plugin: what it needs from Discord, and (optionally) a quick check that its own logic works. */
const NEEDS: Record<string, Array<[string, () => boolean | string]>> = {
    "deltacord.messagelogger": [
        ["Chat row builder (RowManager)", () => fn(findByName("RowManager")?.prototype, "generate") || fn(findByName("RowManager", false)?.default?.prototype, "generate")],
        ["Message store", () => fn(findByStoreName("MessageStore"), "getMessage")],
        ["Marking in chat", () => (rowManagerFound() ? `colours (${rowsStyledCount()} rows styled)` : "text notes (fallback)")],
        ["Caught this session", () => (isLoggerRunning()
            ? `${loggerStats.deletesKept}/${loggerStats.deletesSeen} deletes kept, ${loggerStats.editsLogged} edits, ${loggerStats.restored} restored`
            : "logger not running")],
    ],
    "deltacord.tweaks": [
        ["Analytics (track)", () => !!findByProps("track", "trackMaker") || !!findByProps("trackWithMetadata")],
        ["Gift & apps buttons", () => {
            const { chatButtonsHidden } = require("@core/plugins/tweaks");
            if (chatButtonsHidden.size) return `hidden: ${[...chatButtonsHidden].map((n: string) => n.replace("ChatInputActionButton", "")).join(", ")}`;
            return "waiting for Discord to load the chat bar (open a chat, then run Doctor again)";
        }],
        ["Chat row builder (timestamps)", () => fn(findByName("RowManager")?.prototype, "generate")],
    ],
    "deltacord.hiddenchannels": [
        ["Permission check", () => hiddenState.permissionCheck],
        ["Chat screen", () => hiddenState.chatScreen ?? false],
        ["Message loading", () => (hiddenState.messageFetchers ? `${hiddenState.messageFetchers} found` : false)],
        ["View-channel permission", () => constants?.Permissions?.VIEW_CHANNEL != null],
    ],
    "deltacord.cleanlinks": [
        ["Sending messages", () => fn(messageUtil, "sendMessage")],
        ["Cleans a test link", () => cleanLink("https://youtu.be/x?si=abc&t=5") === "https://youtu.be/x?t=5"],
    ],
    "deltacord.betterembeds": [["Sending messages", () => fn(messageUtil, "sendMessage")]],
    "deltacord.noreplyping": [["Reply code (createPendingReply)", () => fn(findByProps("createPendingReply"), "createPendingReply")]],
    "deltacord.hideblocked": [
        ["Block list (RelationshipStore)", () => fn(findByStoreName("RelationshipStore"), "isBlocked")],
        ["Message events", () => fluxStats.dispatches > 0],
    ],
    "deltacord.alwaystrust": [["Link check", () => {
        const store = findByStoreName("MaskedLinkStore");
        if (fn(store, "isTrustedDomain")) return "MaskedLinkStore";
        if (fn(findByProps("isLinkTrusted"), "isLinkTrusted")) return "isLinkTrusted";
        return false;
    }]],
    "deltacord.freeemojis": [
        ["Emoji permission check", () => fn(findByProps("canUseEmojisEverywhere"), "canUseEmojisEverywhere")],
        ["Sending messages", () => fn(messageUtil, "sendMessage")],
    ],
    "deltacord.funcommands": [["Slash commands added", () => commands("roll", "coinflip", "choose", "8ball", "determination", "mock", "uwu", "reverse", "clap")]],
    "deltacord.fancytext": [
        ["Slash commands added", () => commands("fancy")],
        ["Styles text", () => STYLES.bold.apply("Ab") === "𝐀𝐛"],
    ],
    "deltacord.translate": [["Slash commands added", () => commands("translate", "translate-preview")]],
    "deltacord.dictionary": [["Slash commands added", () => commands("define")]],
    "deltacord.calculator": [
        ["Slash commands added", () => commands("calc")],
        ["Works out (3+4)*2", () => calculate("(3+4)*2") === 14],
    ],
    "deltacord.reminders": [["Slash commands added", () => commands("remind", "reminders", "reminders-clear")]],
    "deltacord.keywords": [["Message events", () => fluxStats.dispatches > 0]],
    "deltacord.textreplace": [["Sending messages", () => fn(messageUtil, "sendMessage")]],
    "deltacord.typewriter": [
        ["Chat row builder (RowManager)", () => fn(findByName("RowManager")?.prototype, "generate") || fn(findByName("RowManager", false)?.default?.prototype, "generate")],
        ["Sound player", () => {
            const { soundStatus } = require("@core/deltacord/extras");
            if (soundStatus.fast === true) return "fast (Deltacord module)";
            if (soundStatus.fast === false) return `Discord's player; fast one failed: ${soundStatus.error || "unknown"}`;
            return "not used yet (tap Test the sound in Deltavoice)";
        }],
        ["This session", () => {
            const { voiceStats: v } = require("@core/plugins/typewriter");
            return `${v.typed} typed · skipped: ${v.skipLeave} leaving the chat, ${v.skipBackground} leaving the app · ${v.rushes} hurried after you sent · phone busy ${v.lateTicks}× · redraw every ${v.redrawGap}ms`;
        }],
        ["Message events", () => fluxStats.dispatches > 0],
    ],
};

/** Which of these slash commands are registered; false if any is missing. */
function commands(...names: string[]): string | false {
    const added = new Set(addedCommandNames());
    const missing = names.filter(n => !added.has(n));
    return missing.length ? false : `${names.length} of ${names.length}`;
}

export function runSelfTest(): SelfTestCheck[] {
    const out: SelfTestCheck[] = [];
    const group = "Self-test";

    // Shared plumbing every plugin depends on.
    const shared: Array<[string, () => boolean | string]> = [
        ["Discord's event system", () => fn(FluxDispatcher, "dispatch")],
        ["Events seen by Deltacord", () => (fluxStats.dispatches > 0
            ? `${fluxStats.dispatches} (${fluxStats.viaDispatch} sent in the app, ${fluxStats.viaInterceptor} only from Discord's servers, ${fluxStats.blocked} blocked)`
            : false)],
        ["Sending messages", () => fn(messageUtil, "sendMessage")],
        ["Bot replies (only you see)", () => fn(messageUtil, "sendBotMessage")],
        ["Image cropper (avatars, banners)", () => {
            if (!require("@lib/api/native/bridge").hasNativeBridge()) return "Discord's own (iPhone)";
            const { cropperStatus } = require("@core/deltacord/cropper");
            const calls = Object.entries(cropperStatus.calls as Record<string, number>).map(([n, c]) => `${n}×${c}`).join(", ") || "none yet";
            if (cropperStatus.lastError) return `last try failed: ${cropperStatus.lastError} · Discord called: ${calls}`;
            if (cropperStatus.patched) return `ready (${cropperStatus.hooks.join(", ")}) · opened ${cropperStatus.opened}, saved ${cropperStatus.saved} · Discord called: ${calls}`;
            return "waiting for Discord to load its image picker (open Edit Profile, then run Doctor again)";
        }],
        ["Message changes applied", () => `${sendStats.sent}${sendStats.failed ? ` (${sendStats.failed} failed)` : ""}`],
    ];
    for (const [label, test] of shared) out.push(result(group, label, test));

    for (const [id, needs] of Object.entries(NEEDS)) {
        const name = require("@core/plugins").pluginName(registeredPlugins.get(id), id);
        const enabled = isPluginEnabled(id);
        const running = pluginInstances.has(id);
        if (!enabled) {
            out.push({ group, label: name, value: "turned off", status: "info" });
            continue;
        }
        const rows = needs.map(([label, test]) => result(`Self-test: ${name}`, label, test));
        const problems = rows.filter(r => r.status !== "ok");
        if (running && !problems.length) {
            // All good: one line, with the details underneath.
            out.push({
                group,
                label: name,
                value: `working · ${rows.length} check${rows.length === 1 ? "" : "s"} passed`,
                status: "ok",
                hint: rows.map(r => `${r.label}: ${r.value}`).join(" · "),
            });
            continue;
        }
        out.push({
            group: `Self-test: ${name}`,
            label: "Running",
            value: running ? "yes" : "on, but not running",
            status: running ? "ok" : "bad",
            hint: running ? undefined : "It failed to start. Turn it off and on in Plugins, then run Doctor again.",
        });
        out.push(...rows);
    }
    return out;
}

function result(group: string, label: string, test: () => boolean | string): SelfTestCheck {
    try {
        const value = test();
        if (value === false) return { group, label, value: "not found", status: "bad", hint: "This part of Discord moved in your version; send the report so it can be fixed." };
        return { group, label, value: value === true ? "ok" : String(value), status: "ok" };
    } catch (e: any) {
        return { group, label, value: `error: ${e?.message ?? e}`, status: "warn" };
    }
}
