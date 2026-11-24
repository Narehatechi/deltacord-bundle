/**
 * Styles chat rows for logged messages.
 *
 * Discord builds each chat row in RowManager.prototype.generate. After it does, for a logged
 * message:
 * - deleted: red text (Discord has no text-colour field, so the text is wrapped in a coloured
 *   link node, the same trick other current mods use), a red-tinted background with a red bar,
 *   and a "deleted 3:04 PM" label,
 * - edited: the earlier versions in grey above the current text, with the words that were
 *   changed standing out, and an "edited" label.
 * Our nodes are tagged, so a row generated again from our output is cleaned first.
 */
import { after } from "@lib/api/patcher";
import { findByName } from "@metro";
import { processColor } from "react-native";

import { lifetime, wordDiff } from "./diff";
import { marking } from "./logger";
import { deletedHex, getSettings, logs } from "./store";

const MESSAGE_ROW = 1;
/** Words an edit took out, in the earlier version shown above the message. */
const CHANGED = "#F0B232";
const GREY = "#9A9AA6";
const INLINE = new Set(["text", "strong", "em", "u", "s", "inlineCode", "emoji", "customEmoji"]);
const MAX_SHOWN = 5;

const OURS = "__deltacordLog";
const BASE = "__deltacordBase";
const OUT = "__deltacordOut";

const seen = new Set<string>();
let rowsStyled = 0;
export const rowsStyledCount = () => rowsStyled;
export const rowManagerFound = () => marking.rowsWork;

function clock(ms: number) {
    const d = new Date(ms);
    const h = d.getHours();
    const time = `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
    return d.toDateString() === new Date().toDateString() ? time : `${d.getMonth() + 1}/${d.getDate()} ${time}`;
}

const color = (hex: string) => processColor(hex) as unknown as number;

/** When the message was sent (Discord ids carry their creation time). */
function sentAt(id: string): number {
    try {
        return Number((BigInt(id) >> 22n) + 1420070400000n);
    } catch {
        return 0;
    }
}

/** Wraps runs of inline nodes in a link node that carries a colour. */
function paint(nodes: any[], linkColor: number | null): any[] {
    if (linkColor == null) return nodes;
    const out: any[] = [];
    let run: any[] = [];
    const flush = () => {
        if (!run.length) return;
        out.push({
            type: "link",
            target: "usernameOnClick",
            context: { username: "", usernameOnClick: { action: "0", userId: "0", linkColor, messageChannelId: "0" } },
            content: run,
        });
        run = [];
    };
    for (const node of nodes) {
        if (node && INLINE.has(node.type)) run.push(node);
        else {
            flush();
            out.push(node);
        }
    }
    flush();
    return out;
}

const tag = (nodes: any[]) => {
    for (const n of nodes) if (n && typeof n === "object") n[OURS] = true;
    return nodes;
};
const isOurs = (n: any) => !!n && typeof n === "object" && n[OURS] === true;

function decorate(row: any, input: any) {
    if (!row?.message) return;
    const rowType = input?.rowType ?? row.rowType;
    if (rowType !== MESSAGE_ROW) return;
    const message = row.message;
    if (!message.id) return;
    seen.add(message.id);
    if (seen.size > 2000) seen.delete(seen.values().next().value!);

    // Undo anything we added last time (the row may be regenerated from our own output).
    let base = message[OUT] && message.content === message[OUT] ? message[BASE] : message.content;
    if (Array.isArray(base) && base.some(isOurs)) base = base.filter(n => !isOurs(n));

    const log = logs.get(message.id);
    const settings = getSettings();
    const deleted = !!log?.deleted;
    const versions = settings.showEditsInChat && log?.edits?.length ? log.edits : null;
    if (!deleted && !versions) {
        if (base !== message.content) message.content = base;
        return;
    }
    if (!Array.isArray(base)) return;

    const hex = deletedHex(settings.deletedColor);
    const red = deleted && settings.redText ? color(hex) : null;
    const grey = color(GREY);
    let out = deleted ? paint(base, red) : base;

    if (versions) {
        let head: any[] = [];
        const first = Math.max(0, versions.length - MAX_SHOWN);
        const latest = log!.current ?? (deleted ? log!.raw?.content : undefined);
        for (let i = first; i < versions.length; i++) {
            const text = versions[i].content;
            // What this version turned into: the next version, or the message as it is now.
            const next: string | undefined = versions[i + 1]?.content ?? latest;
            const pieces = settings.highlightChanges && typeof next === "string" ? wordDiff(text, next).filter(p => p.kind !== "added") : null;
            if (pieces?.some(p => p.kind === "removed") && pieces.some(p => p.kind === "same")) {
                const changedColor = color(CHANGED);
                for (const piece of pieces) {
                    head = head.concat(tag(paint([{ type: "text", content: piece.text }], piece.kind === "removed" ? changedColor : grey)));
                }
                head = head.concat(tag(paint([{ type: "text", content: "\n" }], grey)));
            } else {
                head = head.concat(tag(paint([{ type: "text", content: `${text}\n` }], grey)));
            }
        }
        out = head.concat(out);
    }

    const labels: string[] = [];
    if (deleted) {
        const word = log!.ghostPing ? "ghost ping, deleted" : log!.bulk ? "purged" : "deleted";
        labels.push(settings.showDeleteTime && log!.deletedAt ? `${word} ${clock(log!.deletedAt)}` : word);
        const sent = sentAt(message.id);
        const lasted = log!.deletedAt && sent ? log!.deletedAt - sent : -1;
        // Only worth saying for messages that didn't last long.
        if (settings.showLifetime && lasted >= 0 && lasted < 3_600_000) labels.push(`lasted ${lifetime(lasted)}`);
    }
    if (versions) labels.push(`edited ${versions.length}×`);
    out = out.concat(tag(paint([{ type: "text", content: `  · ${labels.join(" · ")}` }], deleted ? (red ?? grey) : grey)));

    message[BASE] = base;
    message[OUT] = out;
    message.content = out;

    if (deleted) {
        row.backgroundHighlight = { backgroundColor: color(`${hex}26`), gutterColor: color(hex) };
    } else if (!row.backgroundHighlight) {
        row.backgroundHighlight = { backgroundColor: color(`${GREY}14`), gutterColor: color(`${GREY}80`) };
    }
    rowsStyled++;
}

export function patchRows() {
    let RowManager = findByName("RowManager");
    if (!RowManager?.prototype?.generate) RowManager = findByName("RowManager", false)?.default;
    if (!RowManager?.prototype?.generate) {
        console.error("[Deltalogger] RowManager not found; deleted/edited messages get a note in their text instead");
        marking.rowsWork = false;
        return () => { };
    }
    marking.rowsWork = true;
    marking.rowSeen = (id: string) => seen.has(id);

    let errors = 0;
    return after("generate", RowManager.prototype, ([input]: any[], row: any) => {
        try {
            decorate(row, input);
        } catch (e) {
            if (++errors <= 3) console.error("[Deltalogger] Failed to style a row", e);
        }
    });
}
