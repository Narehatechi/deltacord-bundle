/**
 * Deltacord > Extras > Discord's sounds: swap any of Discord's own sounds for a file, a link or
 * silence, and play them to check.
 */
import { useProxy } from "@core/vendetta/storage";
import { findAssetId } from "@lib/api/assets";
import { Button, Stack, TableRow, TableRowGroup, Text, TextInput } from "@metro/common/components";
import { showToast } from "@ui/toasts";
import { useState } from "react";
import { ScrollView, View } from "react-native";

import { discordSounds, discordSoundsStatus, listDiscordSounds, previewDiscordSound, setReplacement } from "./discordSounds";
import { downloadSound, pickSound } from "./extras";

function SoundRow({ name, label, seen, open, onOpen }: { name: string; label: string; seen: boolean; open: boolean; onOpen: () => void; }) {
    useProxy(discordSounds);
    const own = discordSounds.replacements?.[name];
    const [linking, setLinking] = useState(false);
    const [link, setLink] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");

    const run = async (job: () => Promise<boolean | void>) => {
        setBusy(true);
        setError("");
        try {
            if (await job() !== false) {
                showToast(`★ ${label} changed`, findAssetId("StarIcon"));
                setLinking(false);
                setLink("");
            }
        } catch (e: any) {
            setError(e?.message ?? String(e));
        } finally {
            setBusy(false);
        }
    };

    const status = own ? (own.file === "silent" ? "Silent" : `Yours: ${own.name}`) : "Discord's sound";

    return (
        <View>
            <TableRow
                label={label}
                subLabel={`${status}${seen ? "" : " · not heard on this phone yet"}`}
                icon={<TableRow.Icon source={findAssetId(own ? (own.file === "silent" ? "VoiceXIcon" : "StarIcon") : "BellIcon") ?? findAssetId("BellIcon")} />}
                onPress={onOpen}
                trailing={<Button size="sm" variant="secondary" text="Play" onPress={() => {
                    if (own?.file === "silent") return showToast(`${label} is silent`, findAssetId("VoiceXIcon"));
                    if (!previewDiscordSound(name)) showToast("Discord hasn't loaded that sound yet. Hear it once in Discord first.", findAssetId("BellIcon"));
                }} />}
            />
            {open && <View style={{ paddingHorizontal: 12, paddingBottom: 14, gap: 8 }}>
                {linking && <TextInput
                    size="md"
                    value={link}
                    placeholder="https://…/sound.mp3"
                    isClearable={true}
                    autoCapitalize="none"
                    onChange={(v: string) => { setLink(v); if (error) setError(""); }}
                    state={error ? "error" : undefined}
                    errorMessage={error || undefined}
                />}
                {!linking && !!error && <Text variant="text-xs/medium" color="text-danger">{error}</Text>}
                <Stack direction="horizontal" spacing={8}>
                    {linking
                        ? <Button size="sm" variant="primary" text={busy ? "Downloading…" : "Use this link"} disabled={busy || !link.trim()} onPress={() => run(async () => {
                            const file = await downloadSound(link, `discord-${name}`);
                            setReplacement(name, { file, name: decodeURIComponent(link.split("?")[0].split("/").pop() || "your sound") });
                        })} />
                        : <Button size="sm" variant="primary" text={busy ? "Importing…" : "Pick a file"} disabled={busy} onPress={() => run(async () => {
                            const picked = await pickSound();
                            if (!picked) return false;
                            setReplacement(name, { file: picked.file, name: picked.name });
                        })} />}
                    <Button size="sm" variant="secondary" text={linking ? "Cancel" : "Link"} disabled={busy} onPress={() => { setLinking(!linking); setError(""); }} />
                    {!linking && own?.file !== "silent" && <Button size="sm" variant="secondary" text="Silence" disabled={busy} onPress={() => run(async () => setReplacement(name, { file: "silent", name: "Silent" }))} />}
                    {!linking && own && <Button size="sm" variant="secondary" text="Reset" disabled={busy} onPress={() => run(async () => setReplacement(name, null))} />}
                </Stack>
            </View>}
        </View>
    );
}

export default function DiscordSoundsPage() {
    useProxy(discordSounds);
    const [open, setOpen] = useState<string | null>(null);
    const sounds = listDiscordSounds();
    const heard = sounds.filter(s => s.seen);
    const others = sounds.filter(s => !s.seen);
    const changed = Object.keys(discordSounds.replacements ?? {}).length;

    const row = (s: typeof sounds[number]) => <SoundRow key={s.name} {...s} open={open === s.name} onOpen={() => setOpen(open === s.name ? null : s.name)} />;

    return (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}>
            <Text variant="text-sm/medium" color="text-muted">
                Swap any of Discord's own sounds for your own (a WAV, MP3 or OGG from your phone, or a link), or make it silent. Tap a sound for its options. Discord plays yours with its usual volume and timing.
            </Text>
            {!discordSoundsStatus.patched && <Text variant="text-sm/semibold" color="text-danger">
                Deltacord couldn't reach Discord's sound player{discordSoundsStatus.error ? ` (${discordSoundsStatus.error})` : ""}, so changes won't play yet. Send a Doctor report so this can be fixed.
            </Text>}
            {changed > 0 && <Button size="md" variant="secondary" text={`Reset all ${changed} back to Discord's`} onPress={() => {
                for (const name of Object.keys(discordSounds.replacements ?? {})) setReplacement(name, null);
                showToast("★ All of Discord's sounds are back", findAssetId("StarIcon"));
            }} />}
            {heard.length > 0 && <TableRowGroup title="Heard on this phone">{heard.map(row)}</TableRowGroup>}
            <TableRowGroup title={heard.length ? "Other Discord sounds" : "Discord's sounds"}>{others.map(row)}</TableRowGroup>
            <Text variant="text-xs/medium" color="text-muted">
                "Heard on this phone" lists the sounds Discord has actually used here, so new sounds in later Discord versions show up on their own.
            </Text>
        </ScrollView>
    );
}
