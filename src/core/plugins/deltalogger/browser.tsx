/**
 * Deltalogger's browser: everything it caught, searchable and filterable, grouped by place,
 * person or day. Tap a message to jump to it, see what changed, open its files, copy it, or
 * forget it. Also the numbers page (who deletes the most, where, and when).
 */
import { findAssetId } from "@lib/api/assets";
import { openAlert } from "@lib/ui/alerts";
import { resolveSemanticColor, semanticColors } from "@lib/ui/color";
import { showToast } from "@lib/ui/toasts";
import { clipboard } from "@metro/common";
import { AlertActionButton, AlertActions, AlertModal, Button, Stack, TableRow, TableRowGroup, Text } from "@metro/common/components";
import { findByProps, findByStoreNameLazy } from "@metro/wrappers";
import Search from "@ui/components/Search";
import { useMemo, useState } from "react";
import { FlatList, Linking, Pressable, ScrollView, View } from "react-native";

import { ago, dayOf, describeChange, lifetime, topOf } from "./diff";
import { removeLog } from "./logger";
import { deletedHex, getSettings, Log, logs, setIgnored } from "./store";

const ChannelStore = findByStoreNameLazy("ChannelStore");
const GuildStore = findByStoreNameLazy("GuildStore");
const UserStore = findByStoreNameLazy("UserStore");

type Filter = "deleted" | "edited" | "ghost" | "files" | "all";
type Grouping = "place" | "person" | "day";
const GROUPINGS: Grouping[] = ["place", "person", "day"];
const GROUP_LABEL: Record<Grouping, string> = { place: "By place", person: "By person", day: "By day" };

interface FileLink { name: string; url: string; }

export interface Entry {
    id: string;
    log: Log;
    author: string;
    /** The message's own text. */
    body: string;
    /** Text plus its files, for copying and the list. */
    text: string;
    files: FileLink[];
    when: number;
    place: string;
    search: string;
}

type Row = { kind: "header"; key: string; title: string; } | { kind: "entry"; key: string; entry: Entry; };

/** Discord snowflakes carry their creation time. */
function snowflakeTime(id: string): number {
    try {
        return Number((BigInt(id) >> 22n) + 1420070400000n);
    } catch {
        return 0;
    }
}

function placeOf(log: Log): string {
    try {
        const channel = ChannelStore.getChannel?.(log.channelId);
        if (channel) {
            const guild = channel.guild_id ? GuildStore.getGuild?.(channel.guild_id) : null;
            if (guild) return `${guild.name} › #${channel.name}`;
            if (channel.name) return channel.name;
            const others = (channel.recipients ?? []).map((id: string) => {
                const u = UserStore.getUser?.(id);
                return u?.globalName ?? u?.username ?? "someone";
            });
            if (others.length) return `DM with ${others.join(", ")}`;
        }
    } catch { }
    return `Channel ${log.channelId}`;
}

export function toEntry(id: string, log: Log): Entry {
    const raw = log.raw;
    const author = raw?.author?.global_name ?? raw?.author?.username ?? log.author?.name ?? "Unknown";
    const body: string = (log.deleted ? raw?.content : log.current) ?? raw?.content ?? log.edits[log.edits.length - 1]?.content ?? "";
    const attached: any[] = Array.isArray(raw?.attachments) ? raw.attachments : [];
    const files: FileLink[] = attached
        .map(a => ({ name: String(a?.filename ?? "file"), url: String(a?.url ?? a?.proxy_url ?? "") }))
        .filter(f => /^https?:\/\//.test(f.url));
    const stickers: any[] = Array.isArray(raw?.sticker_items) ? raw.sticker_items : [];
    const extras = [
        ...files.map(f => `[${f.name}] ${f.url}`),
        ...stickers.map(s => `[sticker: ${s?.name ?? "sticker"}]`),
    ];
    const place = placeOf(log);
    const history = log.edits.map(e => e.content).join(" ");
    return {
        id,
        log,
        author,
        body,
        text: [body || (extras.length ? "" : "(no text)"), ...extras].filter(Boolean).join("\n"),
        files,
        when: log.deletedAt ?? log.edits[log.edits.length - 1]?.at ?? snowflakeTime(id),
        place,
        search: `${author} ${body} ${history} ${place} ${files.map(f => f.name).join(" ")}`.toLowerCase(),
    };
}

function mutedColor(): string {
    try {
        return resolveSemanticColor(semanticColors.TEXT_MUTED) ?? "#9A9AA6";
    } catch {
        return "#9A9AA6";
    }
}

function kindOf(log: Log): string {
    if (!log.deleted) return "edited";
    if (log.ghostPing) return "ghost ping";
    return log.bulk ? "purged" : "deleted";
}

function jumpTo(id: string, log: Log) {
    const guild = log.guildId ?? ChannelStore.getChannel?.(log.channelId)?.guild_id ?? "@me";
    const path = `/channels/${guild}/${log.channelId}/${id}`;
    try {
        const router = findByProps("transitionTo", "transitionToGuild");
        if (router?.transitionTo) return void router.transitionTo(path);
    } catch { }
    Linking.openURL(`https://discord.com${path}`);
}

/** Every logged message as an entry, newest first. */
const allEntries = () => [...logs.entries()].map(([id, log]) => toEntry(id, log)).sort((a, b) => b.when - a.when);

/** Everything logged, as plain text (newest first). */
export function exportLogsText(): string {
    const entries = allEntries();
    const lines = [`Deltalogger · ${new Date().toISOString()} · ${entries.length} messages`, ""];
    for (const e of entries) {
        lines.push(`[${new Date(e.when).toISOString()}] ${e.place} · ${e.author} · ${kindOf(e.log)}`);
        for (const [i, edit] of e.log.edits.entries()) lines.push(`  version ${i + 1}: ${edit.content}`);
        lines.push(`  ${e.log.edits.length ? "latest: " : ""}${e.text.replace(/\n/g, "\n  ")}`, "");
    }
    return lines.join("\n");
}

/** Everything logged, as data another tool (or a later Deltalogger) can read. */
export function exportLogsJson(): string {
    return JSON.stringify({
        deltalogger: 1,
        exported: new Date().toISOString(),
        messages: allEntries().map(e => ({
            id: e.id,
            channelId: e.log.channelId,
            guildId: e.log.guildId,
            place: e.place,
            author: e.author,
            authorId: e.log.raw?.author?.id ?? e.log.author?.id,
            kind: kindOf(e.log),
            sentAt: snowflakeTime(e.id) || undefined,
            deletedAt: e.log.deletedAt,
            text: e.body,
            files: e.files,
            edits: e.log.edits,
        })),
    }, null, 1);
}

/** What the message said before, with what each edit changed. */
function historyText(entry: Entry): string {
    const { edits } = entry.log;
    if (!edits.length) return "";
    const lines = ["Earlier versions:"];
    edits.forEach((edit, i) => {
        lines.push(`${i + 1}. ${edit.content}`);
        const change = describeChange(edit.content, edits[i + 1]?.content ?? entry.body);
        if (change) lines.push(change.replace(/^/gm, "    "));
    });
    return lines.join("\n");
}

/** The details of one logged message, with everything you can do to it. */
export function openEntry(entry: Entry, refresh: () => void = () => { }) {
    const { id, log } = entry;
    const authorId = log.raw?.author?.id ?? log.author?.id;
    const guildId = log.guildId ?? ChannelStore.getChannel?.(log.channelId)?.guild_id;
    const sent = snowflakeTime(id);
    const facts = [
        entry.place,
        sent ? `Sent ${new Date(sent).toLocaleString()}` : "",
        log.deleted && log.deletedAt ? `Deleted ${new Date(log.deletedAt).toLocaleString()}${sent ? ` (lasted ${lifetime(log.deletedAt - sent)})` : ""}` : "",
    ].filter(Boolean).join("\n");
    const ignore = (list: "ignoredUsers" | "ignoredChannels" | "ignoredGuilds", what: string, value?: string) => value ? (
        <AlertActionButton
            text={`Ignore this ${what}`}
            variant="secondary"
            onPress={() => {
                setIgnored(list, value, true);
                showToast(`New messages from this ${what} won't be logged`, findAssetId("EyeSlashIcon") ?? findAssetId("CheckmarkLargeIcon"));
            }}
        />
    ) : null;
    openAlert(
        "deltacord-logged-message",
        <AlertModal
            title={`${entry.author} · ${kindOf(log)} ${ago(entry.when)}`}
            content={[entry.text, historyText(entry), facts].filter(Boolean).join("\n\n")}
            actions={<AlertActions>
                <AlertActionButton text="Jump to message" variant="primary" onPress={() => jumpTo(id, log)} />
                {entry.files.slice(0, 3).map((file, i) => (
                    <AlertActionButton
                        key={`file-${i}`}
                        text={`Open ${file.name.length > 24 ? `${file.name.slice(0, 24)}…` : file.name}`}
                        variant="secondary"
                        onPress={() => void Linking.openURL(file.url).catch(() => showToast("Couldn't open that file. Discord may have removed it.", findAssetId("CircleXIcon-primary")))}
                    />
                ))}
                <AlertActionButton
                    text="Copy text"
                    variant="secondary"
                    onPress={() => {
                        clipboard.setString(entry.text);
                        showToast("Copied", findAssetId("CopyIcon"));
                    }}
                />
                {ignore("ignoredUsers", "person", authorId)}
                {ignore("ignoredChannels", "channel", log.channelId)}
                {ignore("ignoredGuilds", "server", guildId)}
                <AlertActionButton
                    text="Forget this message"
                    variant="destructive"
                    onPress={() => {
                        removeLog(id);
                        refresh();
                    }}
                />
            </AlertActions>}
        />
    );
}

const matches = (filter: Filter, log: Log) => filter === "all"
    || (filter === "deleted" ? log.deleted
        : filter === "ghost" ? !!log.ghostPing
            : filter === "files" ? Array.isArray(log.raw?.attachments) && log.raw.attachments.length > 0
                : !log.deleted && log.edits.length > 0);

export default function LogBrowser() {
    const [query, setQuery] = useState("");
    const [filter, setFilter] = useState<Filter>("deleted");
    const [grouping, setGrouping] = useState<Grouping>("place");
    const [oldestFirst, setOldestFirst] = useState(false);
    const [version, setVersion] = useState(0);
    const refresh = () => setVersion(v => v + 1);
    const deletedColor = deletedHex(getSettings().deletedColor);
    const muted = useMemo(mutedColor, []);

    const { rows, shown } = useMemo(() => {
        const q = query.trim().toLowerCase();
        const entries = [...logs.entries()]
            .filter(([, log]) => matches(filter, log))
            .map(([id, log]) => toEntry(id, log))
            .filter(e => !q || e.search.includes(q))
            .sort((a, b) => (oldestFirst ? a.when - b.when : b.when - a.when));

        // Groups keep the order their first message appears in.
        const groups = new Map<string, Entry[]>();
        for (const e of entries) {
            const key = grouping === "place" ? e.place : grouping === "person" ? e.author : dayOf(e.when);
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)!.push(e);
        }
        const out: Row[] = [];
        for (const [name, list] of groups) {
            out.push({ kind: "header", key: `h:${name}`, title: `${name} (${list.length})` });
            for (const e of list) out.push({ kind: "entry", key: e.id, entry: e });
        }
        return { rows: out, shown: entries };
    }, [query, filter, grouping, oldestFirst, version]);

    const filterButton = (value: Filter, label: string) => (
        <Button
            size="sm"
            variant={filter === value ? "primary" : "secondary"}
            text={label}
            onPress={() => setFilter(value)}
        />
    );

    const forgetShown = () => openAlert(
        "deltacord-forget-shown",
        <AlertModal
            title={`Forget ${shown.length} message${shown.length === 1 ? "" : "s"}?`}
            content="Every message in this list is forgotten, and the deleted ones leave your chats. This can't be undone."
            actions={<AlertActions>
                <AlertActionButton
                    text="Forget them"
                    variant="destructive"
                    onPress={() => {
                        for (const e of shown) removeLog(e.id);
                        refresh();
                        showToast(`Forgot ${shown.length} messages`, findAssetId("TrashIcon"));
                    }}
                />
                <AlertActionButton text="Cancel" variant="secondary" />
            </AlertActions>}
        />
    );

    return (
        <View style={{ flex: 1 }}>
            <Stack style={{ paddingHorizontal: 12, paddingTop: 12 }} spacing={10}>
                <Search placeholder="Search messages, people, channels, files" onChangeText={setQuery} isRound />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                    {filterButton("deleted", "Deleted")}
                    {filterButton("edited", "Edited")}
                    {filterButton("ghost", "Ghost pings")}
                    {filterButton("files", "With files")}
                    {filterButton("all", "All")}
                </ScrollView>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                    <Button size="sm" variant="secondary" text={GROUP_LABEL[grouping]} onPress={() => setGrouping(GROUPINGS[(GROUPINGS.indexOf(grouping) + 1) % GROUPINGS.length])} />
                    <Button size="sm" variant="secondary" text={oldestFirst ? "Oldest first" : "Newest first"} onPress={() => setOldestFirst(v => !v)} />
                    {shown.length > 0 && <Button size="sm" variant="destructive" text={`Forget these ${shown.length}`} onPress={forgetShown} />}
                </ScrollView>
            </Stack>
            <FlatList
                data={rows}
                keyExtractor={r => r.key}
                contentContainerStyle={{ padding: 12, paddingBottom: 48 }}
                initialNumToRender={25}
                ListEmptyComponent={
                    <Text variant="text-md/medium" color="text-muted" style={{ textAlign: "center", marginTop: 32 }}>
                        {query ? "Nothing matches that search." : "Nothing here yet. Deleted and edited messages will show up as they happen."}
                    </Text>
                }
                renderItem={({ item }) => item.kind === "header"
                    ? <Text variant="text-sm/bold" color="text-muted" style={{ marginTop: 16, marginBottom: 6 }}>{item.title}</Text>
                    : <Pressable
                        onPress={() => openEntry(item.entry, refresh)}
                        style={{
                            paddingVertical: 10,
                            paddingHorizontal: 12,
                            marginBottom: 6,
                            borderRadius: 4,
                            borderWidth: 1,
                            borderColor: "rgba(255,255,255,0.18)",
                            borderLeftWidth: 3,
                            borderLeftColor: item.entry.log.deleted ? deletedColor : muted,
                        }}
                    >
                        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                            <Text variant="text-sm/semibold" style={{ flexShrink: 1 }} numberOfLines={1}>
                                {grouping === "person" ? item.entry.place : item.entry.author}
                            </Text>
                            <Text variant="text-xs/medium" color="text-muted">{`${kindOf(item.entry.log)} · ${ago(item.entry.when)}`}</Text>
                        </View>
                        <Text
                            variant="text-md/normal"
                            numberOfLines={4}
                            style={{ marginTop: 2, ...(item.entry.log.deleted ? { color: deletedColor } : null) }}
                        >
                            {item.entry.body || (item.entry.files.length ? "" : "(no text)")}
                        </Text>
                        {(item.entry.log.edits.length > 0 || item.entry.files.length > 0) && (
                            <Text variant="text-xs/medium" color="text-muted" style={{ marginTop: 4 }}>
                                {[
                                    item.entry.log.edits.length ? `Edited ${item.entry.log.edits.length} time${item.entry.log.edits.length > 1 ? "s" : ""}` : "",
                                    item.entry.files.length ? `${item.entry.files.length} file${item.entry.files.length > 1 ? "s" : ""}` : "",
                                ].filter(Boolean).join(" · ")}
                            </Text>
                        )}
                    </Pressable>}
            />
        </View>
    );
}

/** The numbers: how much was caught, by whom, where, and over the last week. */
export function LogStats() {
    const entries = useMemo(allEntries, []);
    const deleted = entries.filter(e => e.log.deleted);
    const quick = deleted
        .map(e => (e.log.deletedAt ?? 0) - snowflakeTime(e.id))
        .filter(ms => ms >= 0)
        .sort((a, b) => a - b);
    const week = [...Array(7)].map((_, i) => {
        const day = dayOf(Date.now() - i * 86_400_000);
        return [day, entries.filter(e => dayOf(e.when) === day).length] as const;
    });
    const group = (title: string, list: Array<readonly [string, number]>, empty: string) => (
        <TableRowGroup title={title}>
            {list.length
                ? list.map(([name, count]) => <TableRow key={name} label={name} trailing={<TableRow.TrailingText text={String(count)} />} />)
                : <TableRow label={empty} />}
        </TableRowGroup>
    );

    return (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 38 }}>
            <Stack style={{ paddingVertical: 24, paddingHorizontal: 12 }} spacing={24}>
                <TableRowGroup title="Caught so far">
                    <TableRow label="Deleted messages" trailing={<TableRow.TrailingText text={String(deleted.length)} />} />
                    <TableRow label="Edited messages" trailing={<TableRow.TrailingText text={String(entries.filter(e => e.log.edits.length).length)} />} />
                    <TableRow label="Ghost pings" trailing={<TableRow.TrailingText text={String(entries.filter(e => e.log.ghostPing).length)} />} />
                    <TableRow label="Purged messages" trailing={<TableRow.TrailingText text={String(entries.filter(e => e.log.bulk).length)} />} />
                    <TableRow label="With files" trailing={<TableRow.TrailingText text={String(entries.filter(e => e.files.length).length)} />} />
                    <TableRow
                        label="Quickest delete"
                        subLabel="The shortest time a message lasted before it was deleted."
                        trailing={<TableRow.TrailingText text={quick.length ? lifetime(quick[0]) : "None yet"} />}
                    />
                </TableRowGroup>
                {group("Who deletes the most", topOf(deleted.map(e => e.author)), "Nobody yet")}
                {group("Who edits the most", topOf(entries.filter(e => e.log.edits.length).map(e => e.author)), "Nobody yet")}
                {group("Where it happens", topOf(entries.map(e => e.place)), "Nowhere yet")}
                {group("The last 7 days", week, "Nothing yet")}
            </Stack>
        </ScrollView>
    );
}
