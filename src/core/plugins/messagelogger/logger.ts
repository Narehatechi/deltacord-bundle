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
import { findAssetId } from "@lib/api/assets";
import { showToast } from "@lib/ui/toasts";
import { FluxDispatcher } from "@metro/common";
import { findByStoreNameLazy } from "@metro/wrappers";

import { getSettings, logFor, logs, MAX_EDITS, scheduleSave } from "./store";

const MessageStore = findByStoreNameLazy("MessageStore");
const UserStore = findByStoreNameLazy("UserStore");
const ChannelStore = findByStoreNameLazy("ChannelStore");
const SelectedChannelStore = findByStoreNameLazy("SelectedChannelStore");
const UserGuildSettingsStore = findByStoreNameLazy("UserGuildSettingsStore");

/** What the logger has seen this launch (shown in its settings, to tell if it's working). */
export const stats = {
    events: 0,
    deletesSeen: 0,
    deletesKept: 0,
    editsSeen: 0,
    editsLogged: 0,
    ghostPings: 0,
    restored: 0,
};

/**
 * If Discord's chat rows can't be styled (a Discord change), deleted and edited messages get a
 * small note added to their text instead, so they're still marked. Set by rows.ts.
 */
export const marking = { rowsWork: true, rowSeen: (_id: string) => true };

const DELETED_NOTE = "\n-# \u{1F5D1} deleted";
const EDITED_NOTE = "\n-# \u270F was: ";
/** Deltacord's notes are taken off before text is saved or compared. */
export const withoutNotes = (content: string) => {
    if (typeof content !== "string") return content;
    const cut = [content.indexOf(DELETED_NOTE), content.indexOf(EDITED_NOTE)].filter(i => i >= 0);
    return cut.length ? content.slice(0, Math.min(...cut)) : content;
};

function clock(ms: number) {
    const d = new Date(ms);
    const h = d.getHours();
    return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** The note added to a message's text when rows can't be styled. */
function noteFor(id: string, base: string): string {
    const log = logs.get(id);
    if (!log) return base;
    let out = base;
    const settings = getSettings();
    if (settings.showEditsInChat && log.edits.length) {
        const last = log.edits[log.edits.length - 1].content;
        out += EDITED_NOTE + (last.length > 300 ? `${last.slice(0, 300)}…` : last).replace(/\n/g, " ");
    }
    if (log.deleted) out += DELETED_NOTE + (settings.showDeleteTime && log.deletedAt ? ` ${clock(log.deletedAt)}` : "");
    return out;
}

/** Puts the note into the message's text (only used when rows can't be styled). */
function applyNote(channelId: string, id: string, guildId?: string) {
    const record = MessageStore.getMessage?.(channelId, id);
    if (!record) return;
    const content = noteFor(id, withoutNotes(record.content ?? ""));
    if (content === record.content) return;
    bypassed.add(id);
    try {
        FluxDispatcher.dispatch({ type: "MESSAGE_UPDATE", guildId, message: { id, channel_id: channelId, content } });
    } catch { } finally {
        bypassed.delete(id);
    }
}

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

const myId = () => UserStore.getCurrentUser?.()?.id;

function shouldLog(record: any, channelId?: string, guildId?: string) {
    const settings = getSettings();
    const authorId = record.author?.id;
    if (settings.ignoreBots && record.author?.bot) return false;
    if (settings.ignoreSelf && authorId === myId()) return false;
    if (authorId && settings.ignoredUsers?.includes(authorId)) return false;

    const channel = channelId ? ChannelStore.getChannel?.(channelId) : undefined;
    const guild = guildId ?? channel?.guild_id;
    if (channelId && settings.ignoredChannels?.includes(channelId)) return false;
    if (guild && settings.ignoredGuilds?.includes(guild)) return false;
    if (settings.onlyDMs && guild) return false;
    if (settings.ignoreMuted && guild && channelId) {
        try {
            if (UserGuildSettingsStore.isChannelMuted?.(guild, channelId) || UserGuildSettingsStore.isMuted?.(guild)) return false;
        } catch { }
    }
    return true;
}

/** The message pinged me (not @everyone). */
function pingsMe(record: any): boolean {
    const me = myId();
    if (!me || record.author?.id === me) return false;
    const mentions: any[] = Array.isArray(record.mentions) ? record.mentions : [];
    if (mentions.some(m => m === me || m?.id === me)) return true;
    return typeof record.content === "string" && record.content.includes(`<@${me}>`);
}

function authorName(record: any) {
    const a = record.author ?? {};
    return a.globalName ?? a.global_name ?? a.username ?? "Someone";
}

function placeName(channelId: string) {
    const channel = ChannelStore.getChannel?.(channelId);
    if (!channel) return "a chat";
    return channel.name ? `#${channel.name}` : "your DMs";
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

    const settings = getSettings();
    const ghost = pingsMe(record);
    if (ghost && settings.ghostPings) {
        stats.ghostPings++;
        showToast(`\u{1F47B} Ghost ping from ${authorName(record)} in ${placeName(channelId)}`, findAssetId("AtIcon") ?? findAssetId("BellIcon"));
    } else if (settings.toastDeletes && channelId === SelectedChannelStore.getChannelId?.()) {
        showToast(`${authorName(record)} deleted a message`, findAssetId("TrashIcon"));
    }
    // A ghost ping is kept even from ignored places: that's the point of catching it.
    if (!shouldLog(record, channelId, guildId) && !(ghost && settings.ghostPings)) return false;

    const log = logFor(id, channelId, guildId);
    log.deleted = true;
    log.deletedAt = Date.now();
    log.touched = Date.now();
    if (ghost) log.ghostPing = true;
    log.author ??= { id: record.author?.id, name: authorName(record) };
    // Freshest content wins: the cache may hold an older version from before an edit.
    const raw = rawCache.get(id);
    const content = withoutNotes(record.content ?? raw?.content ?? "");
    log.raw = raw ? { ...raw, content } : { ...rawFromRecord(record), content };
    changed.add(id);
    stats.deletesKept++;
    scheduleSave();
    return true;
}

/** An unused message flag bit: flipping it makes Discord see a change and draw the row again. */
const REDRAW_FLAG = 0x10000000;

/** Makes Discord redraw a message's row (an update with nothing changed is ignored). */
export function redraw(channelId: string, id: string, guildId?: string) {
    const record = MessageStore.getMessage?.(channelId, id);
    if (!record) return;
    bypassed.add(id);
    try {
        FluxDispatcher.dispatch({
            type: "MESSAGE_UPDATE",
            guildId,
            message: { id, channel_id: channelId, guild_id: guildId, flags: (record.flags | 0) ^ REDRAW_FLAG },
        });
    } catch { } finally {
        bypassed.delete(id);
    }
}

/** Asks Discord to redraw a message (it can't be dispatched mid-dispatch, so it's queued). */
export function rerender(channelId: string, id: string, guildId?: string) {
    changed.add(id);
    Promise.resolve().then(() => {
        try {
            if (!marking.rowsWork) return applyNote(channelId, id, guildId);
            redraw(channelId, id, guildId);
        } catch { }
        // On screen but Discord never drew the row through the part Deltacord styles: switch to notes.
        if (channelId === SelectedChannelStore.getChannelId?.()) {
            setTimeout(() => {
                if (marking.rowsWork && !marking.rowSeen(id)) {
                    marking.rowsWork = false;
                    applyNote(channelId, id, guildId);
                }
            }, 1500);
        }
    });
}

function onUpdate(payload: any) {
    const update = payload.message;
    if (!update?.id || !update.channel_id) return;
    if (bypassed.has(update.id)) return;
    cacheRaw({ ...rawCache.get(update.id), ...update });

    const settings = getSettings();
    if (!settings.logEdits) return;

    const record = MessageStore.getMessage(update.channel_id, update.id);
    if (typeof update.content !== "string" || !record?.content) return;
    const before = withoutNotes(record.content);
    const after = withoutNotes(update.content);
    if (after === before) return;
    stats.editsSeen++;
    const guildId = payload.guildId ?? update.guild_id;
    if (!shouldLog(record, update.channel_id, guildId)) return;

    const log = logFor(update.id, update.channel_id, guildId);
    log.edits.push({ content: before, at: Date.now() });
    log.current = after;
    log.author ??= { id: record.author?.id, name: authorName(record) };
    if (log.edits.length > MAX_EDITS) log.edits.splice(0, log.edits.length - MAX_EDITS);
    log.touched = Date.now();
    changed.add(update.id);
    stats.editsLogged++;
    scheduleSave();
    // Without row styling, the earlier version goes into a note once the edit has landed.
    if (!marking.rowsWork && settings.showEditsInChat) {
        Promise.resolve().then(() => applyNote(update.channel_id, update.id, guildId));
    }
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

        messages.push(marking.rowsWork ? { ...raw } : { ...raw, content: noteFor(raw.id, raw.content ?? "") });
        added++;
        stats.restored++;
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
        stats.events++;
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
                    stats.deletesSeen++;
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
                    stats.deletesSeen += ids.length;
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
            : {
                type: "MESSAGE_UPDATE",
                guildId: log.guildId,
                message: {
                    id,
                    channel_id: log.channelId,
                    content: withoutNotes(MessageStore.getMessage?.(log.channelId, id)?.content ?? log.current ?? ""),
                    flags: (MessageStore.getMessage?.(log.channelId, id)?.flags | 0) ^ REDRAW_FLAG,
                },
            });
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
