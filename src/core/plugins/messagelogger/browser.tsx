/**
 * "Deleted messages" browser: everything the logger caught, searchable, grouped by
 * server and channel, newest first. Tap a message to jump to it, copy it, or forget it.
 */
import { findAssetId } from "@lib/api/assets";
import { openAlert } from "@lib/ui/alerts";
import { showToast } from "@lib/ui/toasts";
import Search from "@ui/components/Search";
import { clipboard } from "@metro/common";
import { AlertActionButton, AlertActions, AlertModal, Button, Stack, Text } from "@metro/common/components";
import { findByProps, findByStoreNameLazy } from "@metro/wrappers";
import { useMemo, useState } from "react";
import { FlatList, Linking, Pressable, View } from "react-native";

import { resolveSemanticColor, semanticColors } from "@lib/ui/color";

import { removeLog } from "./logger";
import { Log, logs } from "./store";

const ChannelStore = findByStoreNameLazy("ChannelStore");
const GuildStore = findByStoreNameLazy("GuildStore");
const UserStore = findByStoreNameLazy("UserStore");

type Filter = "deleted" | "edited" | "all";

interface Entry {
    id: string;
    log: Log;
    author: string;
    text: string;
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

function toEntry(id: string, log: Log): Entry {
    const raw = log.raw;
    const author = raw?.author?.global_name ?? raw?.author?.username ?? log.author?.name ?? "Unknown";
    const text = (log.deleted ? raw?.content : log.current) ?? raw?.content ?? log.edits[log.edits.length - 1]?.content ?? "";
    const attachments = raw?.attachments?.length ? ` [${raw.attachments.length} attachment${raw.attachments.length > 1 ? "s" : ""}]` : "";
    const place = placeOf(log);
    const history = log.edits.map(e => e.content).join(" ");
    return {
        id,
        log,
        author,
        text: (text || "(no text)") + attachments,
        when: log.deletedAt ?? log.edits[log.edits.length - 1]?.at ?? snowflakeTime(id),
        place,
        search: `${author} ${text} ${history} ${place}`.toLowerCase(),
    };
}

function dangerColor(): string {
    try {
        return resolveSemanticColor(semanticColors.TEXT_FEEDBACK_CRITICAL) ?? "#FF2A2A";
    } catch {
        return "#FF2A2A";
    }
}

function formatTime(ms: number) {
    if (!ms) return "";
    const d = new Date(ms);
    const sameDay = d.toDateString() === new Date().toDateString();
    return sameDay ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : d.toLocaleDateString();
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

function openEntry(entry: Entry, refresh: () => void) {
    const { id, log } = entry;
    const history = log.edits.map((e, i) => `${i + 1}. ${e.content}`).join("\n");
    openAlert(
        "deltacord-logged-message",
        <AlertModal
            title={`${entry.author} · ${log.deleted ? "deleted" : "edited"} ${formatTime(entry.when)}`}
            content={`${entry.text}${history ? `\n\nEarlier versions:\n${history}` : ""}\n\n${entry.place}`}
            actions={<AlertActions>
                <AlertActionButton text="Jump to message" variant="primary" onPress={() => jumpTo(id, log)} />
                <AlertActionButton
                    text="Copy text"
                    variant="secondary"
                    onPress={() => {
                        clipboard.setString(entry.text);
                        showToast("Copied", findAssetId("CopyIcon"));
                    }}
                />
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

export default function LogBrowser() {
    const [query, setQuery] = useState("");
    const [filter, setFilter] = useState<Filter>("deleted");
    const [version, setVersion] = useState(0);
    const refresh = () => setVersion(v => v + 1);
    const danger = useMemo(dangerColor, []);

    const rows = useMemo<Row[]>(() => {
        const q = query.trim().toLowerCase();
        const entries = [...logs.entries()]
            .filter(([, log]) => filter === "all" || (filter === "deleted" ? log.deleted : !log.deleted && log.edits.length))
            .map(([id, log]) => toEntry(id, log))
            .filter(e => !q || e.search.includes(q))
            .sort((a, b) => b.when - a.when);

        // Group by place, places ordered by their newest message.
        const groups = new Map<string, Entry[]>();
        for (const e of entries) {
            if (!groups.has(e.place)) groups.set(e.place, []);
            groups.get(e.place)!.push(e);
        }
        const out: Row[] = [];
        for (const [place, list] of groups) {
            out.push({ kind: "header", key: `h:${place}`, title: `${place} (${list.length})` });
            for (const e of list) out.push({ kind: "entry", key: e.id, entry: e });
        }
        return out;
    }, [query, filter, version]);

    const filterButton = (value: Filter, label: string) => (
        <Button
            size="sm"
            variant={filter === value ? "primary" : "secondary"}
            text={label}
            onPress={() => setFilter(value)}
        />
    );

    return (
        <View style={{ flex: 1 }}>
            <Stack style={{ paddingHorizontal: 12, paddingTop: 12 }} spacing={10}>
                <Search placeholder="Search messages, people, channels" onChangeText={setQuery} isRound />
                <View style={{ flexDirection: "row", gap: 8 }}>
                    {filterButton("deleted", "Deleted")}
                    {filterButton("edited", "Edited")}
                    {filterButton("all", "All")}
                </View>
            </Stack>
            <FlatList
                data={rows}
                keyExtractor={r => r.key}
                contentContainerStyle={{ padding: 12, paddingBottom: 48 }}
                initialNumToRender={25}
                ListEmptyComponent={
                    <Text variant="text-md/medium" color="text-muted" style={{ textAlign: "center", marginTop: 32 }}>
                        {query ? "Nothing matches that search." : "Nothing logged yet. Deleted and edited messages will show up here."}
                    </Text>
                }
                renderItem={({ item }) => item.kind === "header"
                    ? <Text variant="text-sm/bold" color="text-muted" style={{ marginTop: 16, marginBottom: 6 }}>{item.title}</Text>
                    : <Pressable
                        onPress={() => openEntry(item.entry, refresh)}
                        style={{ paddingVertical: 10, paddingHorizontal: 12, marginBottom: 6, borderRadius: 4, borderWidth: 1, borderColor: "rgba(255,255,255,0.18)" }}
                    >
                        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                            <Text variant="text-sm/semibold">{item.entry.author}</Text>
                            <Text variant="text-xs/medium" color="text-muted">{formatTime(item.entry.when)}</Text>
                        </View>
                        <Text
                            variant="text-md/normal"
                            numberOfLines={4}
                            style={{ marginTop: 2, ...(item.entry.log.deleted ? { color: danger } : null) }}
                        >
                            {item.entry.text}
                        </Text>
                        {item.entry.log.edits.length > 0 && (
                            <Text variant="text-xs/medium" color="text-muted" style={{ marginTop: 4 }}>
                                {`Edited ${item.entry.log.edits.length} time${item.entry.log.edits.length > 1 ? "s" : ""}`}
                            </Text>
                        )}
                    </Pressable>}
            />
        </View>
    );
}
