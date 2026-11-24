/**
 * Adds Deltalogger rows to the menu you get by long-pressing a message it has logged:
 * "Deltalogger: details" (what it said before, when it was deleted, its files) and
 * "Deltalogger: forget this".
 *
 * Discord loads that menu on demand (openLazy); the rows are copies of one already there, so
 * they look like the rest of the menu.
 */
import { after, before } from "@lib/api/patcher";
import { findByProps } from "@metro/wrappers";

import { openEntry, toEntry } from "./browser";
import { removeLog } from "./logger";
import { getSettings, logs } from "./store";

export const menuStatus = { found: false, added: 0 };

export function patchMessageMenu(): () => void {
    const sheets = findByProps("openLazy", "hideActionSheet");
    if (typeof sheets?.openLazy !== "function") {
        console.error("[Deltalogger] Couldn't find Discord's menus; long-press rows are off");
        return () => { };
    }
    menuStatus.found = true;
    const React = require("react");
    const isRow = (node: any) => !!node?.props && typeof node.props.label === "string" && typeof node.props.onPress === "function";
    const KEY = "deltacord-deltalogger";

    const close = () => {
        try {
            sheets.hideActionSheet?.();
        } catch { }
    };

    const addRows = (tree: any, messageId: string) => {
        let done = false;
        const visit = (node: any, depth: number): any => {
            if (done || !node || typeof node !== "object" || depth > 30) return node;
            if (Array.isArray(node)) {
                const rows = node.filter(isRow);
                if (rows.length) {
                    done = true;
                    if (node.some((n: any) => typeof n?.key === "string" && n.key.startsWith(KEY))) return node;
                    const log = logs.get(messageId);
                    if (!log) return node;
                    const details = React.cloneElement(rows[0], {
                        key: `${KEY}-details`,
                        label: log.edits.length
                            ? `Deltalogger: details (${log.edits.length} earlier version${log.edits.length > 1 ? "s" : ""})`
                            : "Deltalogger: details",
                        onPress: () => {
                            close();
                            setTimeout(() => {
                                const current = logs.get(messageId);
                                if (current) openEntry(toEntry(messageId, current));
                            }, 250);
                        },
                    });
                    const forget = React.cloneElement(rows[0], {
                        key: `${KEY}-forget`,
                        label: log.deleted ? "Deltalogger: forget this (it leaves the chat)" : "Deltalogger: forget its edit history",
                        onPress: () => {
                            close();
                            setTimeout(() => removeLog(messageId), 250);
                        },
                    });
                    menuStatus.added++;
                    return [...node, details, forget];
                }
                let changed = false;
                const next = node.map(child => {
                    const out = visit(child, depth + 1);
                    if (out !== child) changed = true;
                    return out;
                });
                return changed ? next : node;
            }
            if (node.props) {
                for (const prop of ["children", "items"]) {
                    const child = node.props[prop];
                    if (!child || typeof child !== "object") continue;
                    const out = visit(child, depth + 1);
                    if (out !== child) return React.cloneElement(node, { [prop]: out });
                }
            }
            return node;
        };
        return visit(tree, 0);
    };

    let undoMenu: (() => unknown) | undefined;
    let menuTimer: ReturnType<typeof setTimeout> | undefined;
    const dropMenuPatch = () => {
        undoMenu?.();
        undoMenu = undefined;
        if (menuTimer) clearTimeout(menuTimer);
    };

    const unpatch = before("openLazy", sheets, (args: any[]) => {
        try {
            dropMenuPatch();
            const [component, key, context] = args;
            const messageId = context?.message?.id;
            if (key !== "MessageLongPressActionSheet" || !messageId || typeof component?.then !== "function") return;
            // Only messages Deltalogger knows about get the rows.
            if (!getSettings().menu || !logs.has(messageId)) return;
            component.then((module: any) => {
                if (!module || typeof module.default !== "function") return;
                // Kept while this menu is open (it can redraw); removed when the next menu opens.
                undoMenu = after("default", module, (_: any, tree: any) => {
                    try {
                        return addRows(tree, messageId);
                    } catch {
                        return tree;
                    }
                });
                menuTimer = setTimeout(dropMenuPatch, 60_000);
            });
        } catch { }
    });
    return () => {
        unpatch();
        dropMenuPatch();
    };
}
