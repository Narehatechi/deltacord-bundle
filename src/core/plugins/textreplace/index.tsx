/**
 * Text Replacer: your own shortcuts, swapped in as you send (":shrug2" → "¯\_(ツ)_/¯",
 * "omw" → "on my way!"). Matches whole words; code is left alone.
 */
import { createMMKVBackend, createStorage, useProxy, wrapSync } from "@core/vendetta/storage";
import { Button, Stack, TableRow, TableRowGroup, Text, TextInput } from "@metro/common/components";
import { useState } from "react";
import { ScrollView } from "react-native";

import { defineCorePlugin } from "..";
import { onSend, outsideCode } from "../shared";

interface Rule { find: string; replace: string; }
const store = wrapSync(createStorage<{ rules?: Rule[]; }>(createMMKVBackend("DELTACORD_TEXT_REPLACE")));
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function applyRules(text: string, rules: Rule[]): string {
    let out = text;
    for (const { find, replace } of rules) {
        if (!find) continue;
        // Whole word (or whole token for things like ":shrug2"), case-sensitive.
        out = out.replace(new RegExp(`(^|\\s)${escape(find)}(?=$|\\s|[.,!?;:])`, "g"), (_m, lead) => lead + replace);
    }
    return out;
}

function RulesPage() {
    useProxy(store);
    const [find, setFind] = useState("");
    const [replace, setReplace] = useState("");
    const rules = store.rules ?? [];
    const add = () => {
        if (!find.trim()) return;
        store.rules = [...rules.filter(r => r.find !== find.trim()), { find: find.trim(), replace }];
        setFind("");
        setReplace("");
    };
    return (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 38 }}>
            <Stack style={{ paddingVertical: 24, paddingHorizontal: 12 }} spacing={12}>
                <TextInput label="When I type" value={find} placeholder="omw" onChange={setFind} />
                <TextInput label="Send instead" value={replace} placeholder="on my way!" onChange={setReplace} />
                <Button text="Add shortcut" onPress={add} disabled={!find.trim()} />
                <TableRowGroup title={`Shortcuts (${rules.length})`}>
                    {rules.length
                        ? rules.map(r => (
                            <TableRow key={r.find} label={`${r.find} → ${r.replace || "(nothing)"}`} subLabel="Tap to remove"
                                onPress={() => void (store.rules = rules.filter(x => x.find !== r.find))} />
                        ))
                        : <TableRow label="No shortcuts yet" subLabel="Add one above." />}
                </TableRowGroup>
                <Text variant="text-xs/medium" color="text-muted">Shortcuts match whole words, and never inside `code`.</Text>
            </Stack>
        </ScrollView>
    );
}

let undo: (() => void) | undefined;

export default defineCorePlugin({
    manifest: {
        id: "deltacord.textreplace",
        name: "Text Replacer",
        version: "1.0.0",
        description: "Your own shortcuts, swapped in as you send (omw → on my way!). Add them in its settings.",
        authors: [{ name: "Deltacord" }],
    },
    start() {
        undo = onSend(message => {
            const rules = store.rules ?? [];
            if (rules.length) message.content = outsideCode(message.content, t => applyRules(t, rules));
        });
    },
    stop() {
        undo?.();
        undo = undefined;
    },
    SettingsComponent: RulesPage,
} as any);
