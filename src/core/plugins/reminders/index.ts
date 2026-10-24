/**
 * Reminders: /remind in:<time> text: reminds you later with a notice and a message in that chat
 * (only you see it). /reminders lists them, /reminders-clear removes them. Saved, so they
 * survive restarts; one that came due while Discord was closed shows when it next opens.
 */
import { awaitStorage, createMMKVBackend, createStorage, wrapSync } from "@core/vendetta/storage";
import { findAssetId } from "@lib/api/assets";
import { showToast } from "@lib/ui/toasts";

import { defineCorePlugin } from "..";
import { all, option, registerCommands, reply } from "../shared";

const STRING = 3;

interface Reminder {
    id: string;
    at: number;
    text: string;
    channelId: string;
    setAt: number;
}

const store = wrapSync(createStorage<{ list?: Reminder[]; }>(createMMKVBackend("DELTACORD_REMINDERS")));
const list = (): Reminder[] => [...(store.list ?? [])];

/** "10" (minutes), "10m", "2h", "1h30m", "3d", "45s" → milliseconds. */
export function parseDuration(input: string): number | undefined {
    const text = String(input ?? "").trim().toLowerCase();
    if (/^\d+(\.\d+)?$/.test(text)) return Number(text) * 60_000;
    const units: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };
    let total = 0, matched = false;
    for (const [, n, unit] of text.matchAll(/(\d+(?:\.\d+)?)\s*(s|sec|secs|seconds?|m|min|mins|minutes?|h|hr|hrs|hours?|d|days?|w|weeks?)/g)) {
        total += Number(n) * units[unit[0]];
        matched = true;
    }
    return matched && total > 0 ? total : undefined;
}

function when(ms: number) {
    const d = new Date(ms);
    const h = d.getHours();
    const time = `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
    return d.toDateString() === new Date().toDateString() ? time : `${d.getMonth() + 1}/${d.getDate()} ${time}`;
}

function check() {
    const now = Date.now();
    const due = list().filter(r => r.at <= now);
    if (!due.length) return;
    store.list = list().filter(r => r.at > now);
    for (const r of due) {
        showToast(`⏰ ${r.text}`, findAssetId("ClockIcon"));
        reply(r.channelId, `⏰ **Reminder** (set ${when(r.setAt)}): ${r.text}`);
    }
}

let undo: (() => void) | undefined;

export default defineCorePlugin({
    manifest: {
        id: "deltacord.reminders",
        name: "Reminders",
        version: "1.0.0",
        description: "/remind in:10m text reminds you later. /reminders lists them.",
        authors: [{ name: "Deltacord" }],
    },
    start() {
        const timer = setInterval(check, 10_000);
        awaitStorage(store).then(check).catch(() => { });
        undo = all(
            () => clearInterval(timer),
            registerCommands([
                {
                    name: "remind",
                    description: "Remind me later (only you see it)",
                    options: [
                        { name: "in", displayName: "in", description: "When: 10m, 2h, 1h30m, 3d (a plain number is minutes)", type: STRING, required: true },
                        { name: "text", displayName: "text", description: "What to remind you of", type: STRING, required: true },
                    ],
                    execute(args: any[], ctx: any) {
                        const ms = parseDuration(option(args, "in"));
                        if (!ms) return void reply(ctx.channel.id, "Say when, like 10m, 2h, 1h30m or 3d.");
                        const reminder: Reminder = {
                            id: `${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
                            at: Date.now() + ms,
                            text: String(option(args, "text") ?? ""),
                            channelId: ctx.channel.id,
                            setAt: Date.now(),
                        };
                        store.list = [...list(), reminder];
                        reply(ctx.channel.id, `⏰ I'll remind you at ${when(reminder.at)}: ${reminder.text}\n-# Deltacord needs to be open then (or it shows when you next open it).`);
                    },
                },
                {
                    name: "reminders",
                    description: "List your reminders (only you see it)",
                    options: [],
                    execute(_args: any[], ctx: any) {
                        const all = list().sort((a, b) => a.at - b.at);
                        reply(ctx.channel.id, all.length
                            ? `**Reminders (${all.length})**\n${all.map(r => `• ${when(r.at)}: ${r.text}`).join("\n")}`
                            : "No reminders. Add one with /remind.");
                    },
                },
                {
                    name: "reminders-clear",
                    description: "Remove all your reminders",
                    options: [],
                    execute(_args: any[], ctx: any) {
                        const count = list().length;
                        store.list = [];
                        reply(ctx.channel.id, `Removed ${count} reminder${count === 1 ? "" : "s"}.`);
                    },
                },
            ]),
        );
    },
    stop() {
        undo?.();
        undo = undefined;
    },
} as any);
