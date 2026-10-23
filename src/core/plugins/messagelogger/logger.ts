/**
 * Catches Discord's message events before its stores see them.
 *
 * - MESSAGE_DELETE / MESSAGE_DELETE_BULK: blocked for logged messages; the message is
 *   marked deleted and redrawn instead, so it stays in the chat.
 * - MESSAGE_UPDATE: the old text is saved before the edit lands.
 * - LOAD_MESSAGES_SUCCESS: saved deleted messages are put back into the batch Discord
 *   loaded, so they show up again after a restart.
 * - MESSAGE_CREATE / LOAD_MESSAGES_SUCCESS / MESSAGE_UPDATE also feed a small cache of
 *   raw messages, which is the most faithful copy to save when one is deleted.
 */
import { intercept } from "@lib/api/flux";
import { FluxDispatcher } from "@metro/common";
import { findByStoreNameLazy } from "@metro/wrappers";

import { getSettings, logFor, logs, MAX_EDITS, scheduleSave } from "./store";

const MessageStore = findByStoreNameLazy("MessageStore");
const UserStore = findByStoreNameLazy("UserStore");

const EPHEMERAL_FLAG = 1 << 6;
const RAW_CACHE_LIMIT = 3000;

/** Messages whose row must be pushed to native again even though Discord sees no change. */
const changed = new Set<string>();
/** Messages whose real delete/update we're letting through on purpose (removing a log). */
const bypassed = new Set<string>();
/** Recent raw (API-shaped) messages by id. */
const rawCache = new Map<string, any>();

export const takeChanged = (id: string) => changed.delete(id);
export const markChanged = (id: string) => changed.add(id);

function cacheRaw(raw: any) {
    if (!raw?.id) return;
    rawCache.delete(raw.id);
    rawCache.set(raw.id, raw);
    if (rawCache.size > RAW_CACHE_LIMIT) rawCache.delete(rawCache.keys().next().value!);
}

function toIso(time: any): string | null {
    if (time == null) return null;
    try {
        if (typeof time === "string") return time;
        if (typeof time.toISOString === "function") return time.toISOString();
        return new Date(typeof time.valueOf === "function" ? time.valueOf() : time).toISOString();
    } catch {
        return null;
    }
}

/** Best-effort raw copy of a MessageRecord, for when the raw cache doesn't have it. */
function rawFromRecord(record: any): any {
    const author = record.author ?? {};
    return {
        id: record.id,
        channel_id: record.channel_id,
        type: record.type ?? 0,
        content: record.content ?? "",
        author: {
            id: author.id,
            username: author.username,
            global_name: author.globalName ?? author.global_name ?? null,
            avatar: author.avatar ?? null,
            discriminator: author.discriminator ?? "0",
            bot: !!author.bot,
            public_flags: author.publicFlags ?? 0,
        },
        timestamp: toIso(record.timestamp) ?? new Date().toISOString(),
        edited_timestamp: toIso(record.editedTimestamp),
        attachments: Array.isArray(record.attachments) ? record.attachments.map((a: any) => ({ ...a })) : [],
        embeds: [],
        mentions: [],
        mention_roles: [],
        mention_everyone: false,
        pinned: false,
        tts: false,
        flags: record.flags ?? 0,
        message_reference: record.messageReference ?? undefined,
        sticker_items: record.stickerItems ?? undefined,
    };
}

function shouldLog(record: any) {
    const settings = getSettings();
    if (settings.ignoreBots && record.author?.bot) return false;
    if (settings.ignoreSelf && record.author?.id === UserStore.getCurrentUser?.()?.id) return false;
    return true;
}

/** Marks a message deleted if it should be kept. Returns whether the delete must be blocked. */
function keepDeleted(channelId: string, id: string, guildId?: string): boolean {
    if (bypassed.has(id)) return false;
    // Already kept (our own redispatches, or a message we put back after a restart).
    if (logs.get(id)?.deleted) return true;

    const record = MessageStore.getMessage(channelId, id);
    if (!record) return false;
    // Unsent and ephemeral messages are dismissed, not deleted.
    if (record.state && record.state !== "SENT") return false;
    if ((record.flags ?? 0) & EPHEMERAL_FLAG) return false;
    if (!shouldLog(record)) return false;

    const log = logFor(id, channelId, guildId);
    log.deleted = true;
    log.deletedAt = Date.now();
    log.touched = Date.now();
    // Freshest content wins: the cache may hold an older version from before an edit.
    const raw = rawCache.get(id);
    log.raw = raw ? { ...raw, content: record.content ?? raw.content } : rawFromRecord(record);
    changed.add(id);
    scheduleSave();
    return true;
}

/** Asks Discord to redraw a message (it can't be dispatched mid-dispatch, so it's queued). */
export function rerender(channelId: string, id: string, guildId?: string) {
    changed.add(id);
    Promise.resolve().then(() => {
        FluxDispatcher.dispatch({ type: "MESSAGE_UPDATE", guildId, message: { id, channel_id: channelId } });
    });
}

function onUpdate(payload: any) {
    const update = payload.message;
    if (!update?.id || !update.channel_id) return;
    cacheRaw({ ...rawCache.get(update.id), ...update });

    const settings = getSettings();
    if (!settings.logEdits || bypassed.has(update.id)) return;

    const record = MessageStore.getMessage(update.channel_id, update.id);
    if (!record || !shouldLog(record)) return;
    if (typeof update.content !== "string" || !record.content || update.content === record.content) return;

    const log = logFor(update.id, update.channel_id, payload.guildId ?? update.guild_id);
    log.edits.push({ content: record.content, at: Date.now() });
    if (log.edits.length > MAX_EDITS) log.edits.splice(0, log.edits.length - MAX_EDITS);
    log.touched = Date.now();
    changed.add(update.id);
    scheduleSave();
}

const byIdDesc = (a: any, b: any) => {
    const x = BigInt(a.id), y = BigInt(b.id);
    return x === y ? 0 : x > y ? -1 : 1;
};

/** Puts saved deleted messages back into a batch of messages Discord just loaded. */
function onLoadMessages(payload: any) {
    const messages: any[] | undefined = payload.messages;
    if (!Array.isArray(messages)) return;

    // Only touch batches of plain API-shaped messages; anything else is left exactly as Discord sent it.
    const looksRaw = messages.every(m => typeof m?.id === "string" && typeof m.channel_id === "string" && m.author?.id);
    if (!looksRaw) return;
    for (const raw of messages) cacheRaw(raw);

    if (!getSettings().persist) return;

    const channelId = payload.channelId;
    const saved: any[] = [];
    for (const log of logs.values()) {
        if (log.deleted && log.raw && log.channelId === channelId) saved.push(log.raw);
    }
    if (!saved.length) return;

    const present = new Set(messages.map(m => m.id));
    const ids = messages.map(m => BigInt(m.id));
    const newest = ids.length ? ids.reduce((a, b) => (b > a ? b : a)) : null;
    const oldest = ids.length ? ids.reduce((a, b) => (b < a ? b : a)) : null;
    // The latest page of the channel: deleted messages newer than it belong here too.
    const isLatestPage = !payload.isBefore && !payload.isAfter && !payload.jump;
    // Reached the start of the channel: anything older belongs here too.
    const reachedStart = payload.hasMoreBefore === false;

    let added = 0;
    for (const raw of saved) {
        if (present.has(raw.id)) continue;
        const id = BigInt(raw.id);
        const inRange = newest !== null && oldest !== null && id <= newest && id >= oldest;
        const belongs = inRange
            || (isLatestPage && (newest === null || id > newest))
            || (reachedStart && oldest !== null && id < oldest);
        if (!belongs) continue;

        messages.push({ ...raw });
        added++;
    }

    if (added) {
        // Keep whichever order Discord used (newest-first from the API).
        const descending = messages.length < 2 || BigInt(messages[0].id) >= BigInt(messages[messages.length - 1 - added].id);
        messages.sort(descending ? byIdDesc : (a, b) => -byIdDesc(a, b));
    }
}

/** Starts listening. Returns a function that stops. */
export function interceptMessages() {
    const unintercept = intercept(payload => {
        try {
            // Network loads, and loads from Discord's on-device message cache.
            if (payload.type?.startsWith("LOAD_MESSAGES_SUCCESS") || payload.type === "LOCAL_MESSAGES_LOADED") {
                onLoadMessages(payload);
                return;
            }

            switch (payload.type) {
                case "MESSAGE_CREATE":
                    cacheRaw(payload.message);
                    return;

                case "MESSAGE_UPDATE":
                    onUpdate(payload);
                    return;

                case "MESSAGE_DELETE": {
                    if (!getSettings().logDeletes) return;
                    const { id, channelId, guildId } = payload;
                    if (!keepDeleted(channelId, id, guildId)) return;
                    rerender(channelId, id, guildId);
                    return false; // block the real delete
                }

                case "MESSAGE_DELETE_BULK": {
                    if (!getSettings().logDeletes) return;
                    const { ids, channelId, guildId } = payload;
                    if (!Array.isArray(ids)) return;
                    const kept = ids.filter((id: string) => keepDeleted(channelId, id, guildId));
                    if (!kept.length) return;
                    for (const id of kept) rerender(channelId, id, guildId);
                    const rest = ids.filter((id: string) => !kept.includes(id));
                    // Let the rest through; block entirely if everything was kept.
                    return rest.length ? { ids: rest } : false;
                }
            }
        } catch (e) {
            console.error("[MessageLogger] Interceptor error", e);
        }
    });

    return () => {
        unintercept();
        changed.clear();
        rawCache.clear();
    };
}

/** Forgets one message's log; really deletes it from the chat if it was deleted. */
export function removeLog(id: string) {
    const log = logs.get(id);
    if (!log) return;
    logs.delete(id);
    scheduleSave();

    bypassed.add(id);
    changed.add(id);
    try {
        FluxDispatcher.dispatch(log.deleted
            ? { type: "MESSAGE_DELETE", id, channelId: log.channelId, guildId: log.guildId }
            : { type: "MESSAGE_UPDATE", guildId: log.guildId, message: { id, channel_id: log.channelId } });
    } catch {
        // The message may not be loaded right now; nothing to redraw.
    } finally {
        bypassed.delete(id);
    }
}

/** Clears every log and removes deleted messages from the chat. */
export function clearAllLogs() {
    for (const id of [...logs.keys()]) removeLog(id);
    logs.clear();
    scheduleSave();
}
