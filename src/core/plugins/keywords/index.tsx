/**
 * Keyword Alerts: a notice when someone says one of your words (your name, a game, anything),
 * in any chat. Recent matches are listed in the plugin's settings.
 */
import { createMMKVBackend, createStorage, useProxy, wrapSync } from "@core/vendetta/storage";
import { intercept } from "@lib/api/flux";
import { findAssetId } from "@lib/api/assets";
import { showToast } from "@lib/ui/toasts";
import { Button, Stack, TableRow, TableRowGroup, TableSwitchRow, Text, TextInput } from "@metro/common/components";
import { findByStoreNameLazy } from "@metro/wrappers";
import { useState } from "react";
import { ScrollView } from "react-native";

import { defineCorePlugin } from "..";

const UserStore = findByStoreNameLazy("UserStore");
const ChannelStore = findByStoreNameLazy("ChannelStore");
const SelectedChannelStore = findByStoreNameLazy("SelectedChannelStore");

interface Hit { word: string; author: string; place: string; text: string; at: number; }
interface KeywordSettings { words?: string[]; wholeWords?: boolean; inCurrentChat?: boolean; hits?: Hit[]; }

const store = wrapSync(createStorage<KeywordSettings>(createMMKVBackend("DELTACORD_KEYWORDS")));
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The first of `words` found in `text` (case doesn't matter). */
export function findKeyword(text: string, words: string[], wholeWords: boolean): string | undefined {
    for (const word of words) {
        const w = word.trim();
        if (!w) continue;
        const pattern = wholeWords ? new RegExp(`(^|[^A-Za-z0-9_\\u00C0-\\u024F])${escape(w)}($|[^A-Za-z0-9_\\u00C0-\\u024F])`, "i") : new RegExp(escape(w), "i");
        if (pattern.test(text)) return w;
    }
    return undefined;
}

function onMessage(message: any) {
    const words = store.words ?? [];
    if (!words.length || typeof message?.content !== "string") return;
    if (message.author?.id && message.author.id === UserStore.getCurrentUser?.()?.id) return;
    if (!store.inCurrentChat && message.channel_id === SelectedChannelStore.getChannelId?.()) return;
    const word = findKeyword(message.content, words, store.wholeWords ?? true);
    if (!word) return;

    const channel = ChannelStore.getChannel?.(message.channel_id);
    const author = message.author?.global_name ?? message.author?.username ?? "Someone";
    const place = channel?.name ? `#${channel.name}` : "DMs";
    showToast(`🔔 "${word}" · ${author} in ${place}`, findAssetId("BellIcon"));
    store.hits = [{ word, author, place, text: message.content.slice(0, 200), at: Date.now() }, ...(store.hits ?? [])].slice(0, 30);
}

function KeywordSettingsPage() {
    useProxy(store);
    const [draft, setDraft] = useState("");
    const words = store.words ?? [];
    const add = () => {
        const w = draft.trim();
        if (w && !words.some(x => x.toLowerCase() === w.toLowerCase())) store.words = [...words, w];
        setDraft("");
    };
    return (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 38 }}>
            <Stack style={{ paddingVertical: 24, paddingHorizontal: 12 }} spacing={16}>
                <TextInput label="Add a word or phrase" value={draft} placeholder="your name, a game…" onChange={setDraft} onSubmitEditing={add} />
                <Button text="Add" onPress={add} disabled={!draft.trim()} />
                <TableRowGroup title={`Your words (${words.length})`}>
                    {words.length
                        ? words.map(w => <TableRow key={w} label={w} subLabel="Tap to remove" onPress={() => void (store.words = words.filter(x => x !== w))} />)
                        : <TableRow label="No words yet" subLabel="Add one above." />}
                </TableRowGroup>
                <TableRowGroup title="Options">
                    <TableSwitchRow label="Whole words only" subLabel={"\"cat\" won't match \"catch\"."} value={store.wholeWords ?? true} onValueChange={(v: boolean) => void (store.wholeWords = v)} />
                    <TableSwitchRow label="Also in the chat I'm looking at" value={store.inCurrentChat ?? false} onValueChange={(v: boolean) => void (store.inCurrentChat = v)} />
                </TableRowGroup>
                <TableRowGroup title="Recent matches">
                    {(store.hits ?? []).length
                        ? (store.hits ?? []).map((h, i) => <TableRow key={`${h.at}-${i}`} label={`"${h.word}" · ${h.author} in ${h.place}`} subLabel={h.text} />)
                        : <TableRow label="None yet" />}
                </TableRowGroup>
                {(store.hits ?? []).length ? <Button text="Clear matches" variant="secondary" onPress={() => void (store.hits = [])} /> : null}
                <Text variant="text-xs/medium" color="text-muted">Your own messages never count.</Text>
            </Stack>
        </ScrollView>
    );
}

let undo: (() => void) | undefined;

export default defineCorePlugin({
    manifest: {
        id: "deltacord.keywords",
        name: "Keyword Alerts",
        version: "1.0.0",
        description: "A notice when someone says one of your words, in any chat. Add words in its settings.",
        authors: [{ name: "Deltacord" }],
    },
    start() {
        undo = intercept(payload => {
            if (payload.type === "MESSAGE_CREATE" && !payload.optimistic) {
                try {
                    onMessage(payload.message);
                } catch { }
            }
            return undefined;
        });
    },
    stop() {
        undo?.();
        undo = undefined;
    },
    SettingsComponent: KeywordSettingsPage,
} as any);
