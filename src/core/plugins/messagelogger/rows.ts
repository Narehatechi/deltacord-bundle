/**
 * Styles chat rows for logged messages.
 *
 * Discord builds each chat row in RowManager.prototype.generate. After it does:
 * - deleted messages get red text and a "(deleted)" label,
 * - edited messages get their earlier versions shown above the current text,
 * - rows we changed without Discord noticing are flagged so native redraws them.
 */
import { after } from "@lib/api/patcher";
import { resolveSemanticColor, semanticColors } from "@lib/ui/color";
import { findByName } from "@metro";
import { processColor } from "react-native";

import { marking, takeChanged } from "./logger";
import { getSettings, logs } from "./store";

const MESSAGE_ROW = 1;
const CHANGE_TYPE_UPDATE = 2;

const text = (content: string) => ({ type: "text", content });

function criticalColor(): number {
    try {
        const color = resolveSemanticColor(semanticColors.TEXT_FEEDBACK_CRITICAL);
        const processed = processColor(color);
        if (typeof processed === "number") return processed;
    } catch { }
    return processColor("#FF2A2A") as number;
}

/** A copy of a MessageRecord with different content. */
function withContent(record: any, content: string) {
    if (typeof record?.set === "function") {
        try {
            return record.set("content", content);
        } catch { }
    }
    const copy = Object.create(Object.getPrototypeOf(record));
    return Object.assign(copy, record, { content });
}

// Set while we ask Discord to render an old version, so our own patch leaves it alone.
let renderingHistory = false;

/** Messages Discord drew a row for recently (tells whether row styling works). */
const seen = new Set<string>();
let rowsStyled = 0;
export const rowsStyledCount = () => rowsStyled;
export const rowManagerFound = () => marking.rowsWork;

function clock(ms: number) {
    const d = new Date(ms);
    const h = d.getHours();
    return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

export function patchRows() {
    const RowManager = findByName("RowManager");
    if (!RowManager?.prototype?.generate) {
        console.error("[MessageLogger] RowManager not found; deleted/edited messages get a note in their text instead");
        marking.rowsWork = false;
        return () => { };
    }
    marking.rowsWork = true;
    marking.rowSeen = (id: string) => seen.has(id);

    return after("generate", RowManager.prototype, function (this: any, [args]: any[], row: any) {
        if (renderingHistory) return;

        try {
            const message = row?.type === MESSAGE_ROW ? row.message : undefined;
            if (!message?.id) return;
            seen.add(message.id);
            if (seen.size > 2000) seen.delete(seen.values().next().value!);

            if (takeChanged(message.id)) row.changeType = CHANGE_TYPE_UPDATE;

            const log = logs.get(message.id);
            if (!log) return;

            const settings = getSettings();
            const editedLabel = typeof message.edited === "string" && message.edited ? message.edited : "edited";

            if (settings.showEditsInChat && log.edits.length && args?.message) {
                const current = Array.isArray(message.content) ? message.content : [];
                const currentJson = JSON.stringify(current);
                const history: any[] = [];

                for (const edit of log.edits) {
                    let nodes: any[] | undefined;
                    try {
                        renderingHistory = true;
                        const old = this.generate({ ...args, message: withContent(args.message, edit.content) });
                        nodes = old?.message?.content;
                    } catch {
                        nodes = undefined;
                    } finally {
                        renderingHistory = false;
                    }

                    // If Discord handed back the current text (cached parse), fall back to plain text.
                    if (!Array.isArray(nodes) || (JSON.stringify(nodes) === currentJson && edit.content !== args.message.content)) {
                        nodes = [text(edit.content)];
                    }

                    history.push(...nodes, text(` (${editedLabel})\n`));
                }

                message.content = [...history, ...current];
            }

            if (log.deleted) {
                if (settings.redText) message.textColor = criticalColor();
                message.edited = settings.showDeleteTime && log.deletedAt ? `deleted ${clock(log.deletedAt)}` : "deleted";
            }
            rowsStyled++;
        } catch (e) {
            console.error("[MessageLogger] Failed to style a row", e);
        }
    });
}
