/**
 * Small helpers shared by Deltacord's built-in plugins.
 */
import { before } from "@lib/api/patcher";
import { messageUtil } from "@metro/common";

/** Runs `fn` on the parts of a message that aren't inside `code` or ```code blocks```. */
export function outsideCode(content: string, fn: (text: string) => string): string {
    // Odd pieces of the split are code (the delimiters are kept by the capturing group).
    return content
        .split(/(```[\s\S]*?```|`[^`\n]*`)/)
        .map((part, i) => (i % 2 === 1 ? part : fn(part)))
        .join("");
}

/** Every link in some text, rewritten by `fn`. Links in <angle brackets> (no preview) are left alone. */
export function rewriteLinks(text: string, fn: (url: string) => string): string {
    return text.replace(/(<)?(https?:\/\/[^\s<>]+[^\s<>.,:;"')\]!?])(>)?/g, (whole, open, url, close) => {
        if (open && close) return whole;
        try {
            return (open ?? "") + fn(url) + (close ?? "");
        } catch {
            return whole;
        }
    });
}

/**
 * Changes what you send just before it's sent. `transform` gets the message (content and
 * Discord's details about it) and the channel id, and edits it in place.
 * Returns how to undo it.
 */
export function onSend(transform: (message: any, channelId: string) => void): () => void {
    if (typeof messageUtil?.sendMessage !== "function") return () => { };
    return before("sendMessage", messageUtil, (args: any[]) => {
        try {
            const message = args[1];
            if (message && typeof message.content === "string") transform(message, args[0]);
        } catch (e) {
            console.error("[Deltacord] A message change failed; sending as typed", e);
        }
    });
}

/** When a Discord id (snowflake) was made. */
export function snowflakeDate(id: string | undefined): Date | undefined {
    if (!id || !/^\d+$/.test(id)) return undefined;
    // id >> 22 is milliseconds since 2015 (dividing is close enough; no BigInt needed).
    return new Date(Math.floor(Number(id) / 4194304) + 1420070400000);
}

export function shortDate(date: Date | undefined): string {
    if (!date || isNaN(date.getTime())) return "unknown";
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

/** Undoes several things at once. */
export const all = (...undo: Array<(() => unknown) | undefined>) => () => undo.forEach(u => {
    try {
        u?.();
    } catch { }
});
