/**
 * Deltacord > Extras > Hide anything: switch off any of Discord's buttons, banners, tips and
 * upsells, listed by the names Discord gives them.
 */
import { useProxy } from "@core/vendetta/storage";
import { findAssetId } from "@lib/api/assets";
import { Button, TableRowGroup, TableSwitchRow, Text, TextInput } from "@metro/common/components";
import { showToast } from "@ui/toasts";
import { useState } from "react";
import { ScrollView } from "react-native";

import { hiddenThings, hideStatus, listThings, readableName, setHidden, ThingGroup } from "./hideThings";

const ORDER: ThingGroup[] = ["Nitro, Shop and Quests", "Chat bar", "Banners and tips", "Buttons", "Other"];

/** Upsells most people want gone. */
const NITRO = /Upsell|Premium|Nitro|Gift|Shop|Quest|Boost|Promo|Marketing|Collectible|SuperReaction/;

export default function HideThingsPage() {
    useProxy(hiddenThings);
    const [query, setQuery] = useState("");
    const [, refresh] = useState(0);
    const hidden = new Set(hiddenThings.hidden ?? []);
    const q = query.trim().toLowerCase();
    const things = listThings().filter(t => !q || t.name.toLowerCase().includes(q) || readableName(t.name).toLowerCase().includes(q));
    const nitro = listThings().filter(t => NITRO.test(t.name) && t.loaded);

    return (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}>
            <Text variant="text-sm/medium" color="text-muted">
                Switch off anything you don't want to see. These are the parts Discord has loaded so far, named the way Discord names them; open more of Discord (profiles, the chat bar, settings, the Shop) and come back to find more. If something you hide turns out to be needed, switch it back on here.
            </Text>
            {nitro.length > 0 && <Button size="md" variant="primary" text={`Hide all ${nitro.length} Nitro, Shop and Quest parts`} onPress={() => {
                nitro.forEach(t => setHidden(t.name, true));
                showToast("★ Upsells hidden", findAssetId("StarIcon"));
                refresh(n => n + 1);
            }} />}
            <TextInput size="md" value={query} onChange={setQuery} placeholder="Search (gift, banner, sticker…)" isClearable={true} />
            <Text variant="text-xs/medium" color="text-muted">{hideStatus.seen} parts found · {hidden.size} hidden</Text>
            {ORDER.map(group => {
                const list = things.filter(t => t.group === group);
                if (!list.length) return null;
                return <TableRowGroup key={group} title={`${group} (${list.length})`}>
                    {list.map(t => <TableSwitchRow
                        key={t.name}
                        label={readableName(t.name)}
                        subLabel={hidden.has(t.name) ? (t.loaded ? "Hidden" : "Hidden (not loaded yet this session)") : t.name}
                        value={hidden.has(t.name)}
                        onValueChange={(v: boolean) => {
                            setHidden(t.name, v);
                            refresh(n => n + 1);
                        }}
                    />)}
                </TableRowGroup>;
            })}
            {hideStatus.seen === 0 && <Text variant="text-sm/semibold" color="text-danger">Nothing found yet. Use Discord for a moment and come back.</Text>}
        </ScrollView>
    );
}
