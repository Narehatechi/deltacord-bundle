/**
 * Better Embeds: swaps links from sites whose previews are broken in Discord for embed-fixing
 * mirrors (x.com → fxtwitter.com, and so on), so the post shows up properly in chat.
 * Each site has its own switch.
 */
import { createMMKVBackend, createStorage, useProxy, wrapSync } from "@core/vendetta/storage";
import { Stack, TableRowGroup, TableSwitchRow, Text } from "@metro/common/components";
import { ScrollView } from "react-native";

import { defineCorePlugin } from "..";
import { onSend, outsideCode, rewriteLinks } from "../shared";

interface Site {
    id: string;
    name: string;
    hosts: RegExp;
    to: string;
    onByDefault: boolean;
}

export const SITES: Site[] = [
    { id: "twitter", name: "X / Twitter → fxtwitter.com", hosts: /^(www\.|mobile\.)?(twitter\.com|x\.com)$/i, to: "fxtwitter.com", onByDefault: true },
    { id: "bluesky", name: "Bluesky → bskx.app", hosts: /^(www\.)?bsky\.app$/i, to: "bskx.app", onByDefault: true },
    { id: "reddit", name: "Reddit → rxddit.com", hosts: /^(www\.|old\.|new\.)?reddit\.com$/i, to: "rxddit.com", onByDefault: true },
    { id: "instagram", name: "Instagram → ddinstagram.com", hosts: /^(www\.)?instagram\.com$/i, to: "ddinstagram.com", onByDefault: false },
    { id: "tiktok", name: "TikTok → tnktok.com", hosts: /^(www\.|vm\.|vt\.)?tiktok\.com$/i, to: "tnktok.com", onByDefault: false },
];

export const embedSettings = wrapSync(createStorage<Record<string, boolean>>(createMMKVBackend("DELTACORD_EMBEDS")));
const isOn = (site: Site) => embedSettings[site.id] ?? site.onByDefault;

export function fixEmbedLink(url: string): string {
    const match = /^(https?:\/\/)([^/?#]+)(.*)$/i.exec(url);
    if (!match) return url;
    const [, scheme, host, rest] = match;
    for (const site of SITES) {
        if (!isOn(site) || !site.hosts.test(host)) continue;
        // Short TikTok links (vm./vt.) keep their subdomain so the mirror can follow them.
        const sub = site.id === "tiktok" ? /^(vm|vt)\./i.exec(host)?.[0] ?? "" : "";
        return scheme + sub + site.to + rest;
    }
    return url;
}

function EmbedSettings() {
    useProxy(embedSettings);
    return (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 38 }}>
            <Stack style={{ paddingVertical: 24, paddingHorizontal: 12 }} spacing={16}>
                <TableRowGroup title="Fix previews for">
                    {SITES.map(site => (
                        <TableSwitchRow
                            key={site.id}
                            label={site.name}
                            value={isOn(site)}
                            onValueChange={(v: boolean) => void (embedSettings[site.id] = v)}
                        />
                    ))}
                </TableRowGroup>
                <Text variant="text-xs/medium" color="text-muted">
                    Changes links when you send them. Links in &lt;angle brackets&gt; and in code are left alone.
                </Text>
            </Stack>
        </ScrollView>
    );
}

let undo: (() => void) | undefined;

export default defineCorePlugin({
    manifest: {
        id: "deltacord.betterembeds",
        name: "Better Embeds",
        version: "1.0.0",
        description: "Fixes link previews for X/Twitter, Bluesky, Reddit and more by sending embed-friendly links.",
        authors: [{ name: "Deltacord" }],
    },
    start() {
        undo = onSend(message => {
            message.content = outsideCode(message.content, text => rewriteLinks(text, fixEmbedLink));
        });
    },
    stop() {
        undo?.();
        undo = undefined;
    },
    SettingsComponent: EmbedSettings,
} as any);
