/**
 * Deltacord > Jukebox: play music or sounds through your mic, so everyone in a voice call hears
 * them. The module mixes the song into what Discord reads from the microphone; this page keeps
 * your imported songs and works the controls.
 */
import { createMMKVBackend, createStorage, useProxy, wrapSync } from "@core/vendetta/storage";
import { findAssetId } from "@lib/api/assets";
import { callNative, callNativeSync } from "@lib/api/native/bridge";
import { openAlert } from "@lib/ui/alerts";
import { showToast } from "@lib/ui/toasts";
import { AlertActionButton, AlertActions, AlertModal, Button, Stack, TableRow, TableRowGroup, TableSwitchRow, Text } from "@metro/common/components";
import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";

interface Song { path: string; name: string; size: number; }

export const jukebox = wrapSync(createStorage<{
    songs?: Song[];
    /** Music loudness, 0-2. */
    volume?: number;
    /** Your own voice while music plays, 0-1 (0: only the music goes out). */
    voice?: number;
    /** Hear the music yourself as well. */
    hear?: boolean;
    loop?: boolean;
}>(createMMKVBackend("DELTACORD_JUKEBOX")));

interface State {
    path?: string | null;
    playing?: boolean;
    paused?: boolean;
    position?: number;
    duration?: number;
    error?: string | null;
    micOpen?: boolean;
    micRate?: number;
    micReads?: number;
}

const VOLUMES = [0.25, 0.5, 0.75, 1, 1.5, 2];
const VOICES: [number, string][] = [[1, "Mix with my voice"], [0.5, "My voice quieter"], [0, "Only the music"]];

const clock = (s = 0) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const prettyName = (name: string) => name.replace(/^picked-[a-z0-9]+-/, "").replace(/\.[a-z0-9]{2,4}$/i, "").replace(/_/g, " ");

function nativeState(): State | null {
    try {
        return callNativeSync("deltacord.jukebox.state") ?? null;
    } catch {
        return null;
    }
}

function applySettings() {
    try {
        callNativeSync("deltacord.jukebox.set", jukebox.volume ?? 1, jukebox.voice ?? 1, jukebox.hear ?? true);
    } catch { }
}

function fail(e: unknown) {
    showToast(String((e as Error)?.message ?? e), findAssetId("CircleXIcon-primary"));
}

async function importSong() {
    try {
        const picked = await callNative("deltacord.files.pick", "audio/*", "pyoncord/jukebox", 60);
        if (!picked?.path) return;
        jukebox.songs = [...(jukebox.songs ?? []), { path: picked.path, name: prettyName(String(picked.name ?? "song")), size: Number(picked.size) || 0 }];
        showToast("Added to the jukebox", findAssetId("CheckmarkLargeIcon"));
    } catch (e) {
        fail(e);
    }
}

function play(song: Song) {
    try {
        applySettings();
        callNativeSync("deltacord.jukebox.play", song.path, jukebox.loop ?? false);
    } catch (e) {
        fail(e);
    }
}

function removeSong(song: Song) {
    openAlert("deltacord-jukebox-remove", <AlertModal
        title={`Remove ${song.name}?`}
        content="It's deleted from Deltacord. The file you imported it from stays where it was."
        actions={<AlertActions>
            <AlertActionButton text="Remove" variant="destructive" onPress={() => {
                try {
                    callNativeSync("deltacord.jukebox.remove", song.path);
                } catch { }
                jukebox.songs = (jukebox.songs ?? []).filter(s => s.path !== song.path);
            }} />
            <AlertActionButton text="Cancel" variant="secondary" />
        </AlertActions>}
    />);
}

export default function JukeboxPage() {
    useProxy(jukebox);
    const [state, setState] = useState<State | null>(nativeState);

    useEffect(() => {
        applySettings();
        const timer = setInterval(() => setState(nativeState()), 500);
        return () => clearInterval(timer);
    }, []);

    if (!state) {
        return <ScrollView contentContainerStyle={{ padding: 16 }}>
            <Text variant="text-md/semibold" color="text-danger">
                The jukebox needs a newer Deltacord module. Open Deltacord Manager to update it, then restart Discord.
            </Text>
        </ScrollView>;
    }

    const songs = jukebox.songs ?? [];
    const current = songs.find(s => s.path === state.path);
    const active = !!state.playing;
    const volume = jukebox.volume ?? 1;
    const voice = jukebox.voice ?? 1;
    const cycleVolume = () => {
        jukebox.volume = VOLUMES[(VOLUMES.indexOf(volume) + 1) % VOLUMES.length] ?? 1;
        applySettings();
    };
    const cycleVoice = () => {
        const i = VOICES.findIndex(([v]) => v === voice);
        jukebox.voice = VOICES[(i + 1) % VOICES.length][0];
        applySettings();
    };

    const status = state.micOpen
        ? `Your mic is on in a call${state.micRate ? ` (${Math.round(state.micRate / 1000)} kHz)` : ""}. Everyone hears what plays.`
        : active
            ? "Waiting for a call. The music starts once you're in a voice call with your mic on."
            : "Join a voice call and pick something to play. Only you need Deltacord; everyone hears it.";

    return (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 48 }}>
            <Stack style={{ paddingVertical: 24, paddingHorizontal: 12 }} spacing={20}>
                <Text variant="text-sm/medium" color="text-muted">{status}</Text>

                <TableRowGroup title="Now playing">
                    <TableRow
                        label={active ? (current?.name ?? "A song") : "Nothing"}
                        subLabel={state.error
                            ? `Couldn't play it: ${state.error}`
                            : active
                                ? `${clock(state.position)}${state.duration ? ` / ${clock(state.duration)}` : ""}${state.paused ? " · paused" : ""}${jukebox.loop ? " · looping" : ""}`
                                : "Tap a song below to play it"}
                        icon={findAssetId("MusicIcon") ? <TableRow.Icon source={findAssetId("MusicIcon")!} /> : undefined}
                    />
                </TableRowGroup>
                {active && <View style={{ flexDirection: "row", gap: 8 }}>
                    <Button style={{ flex: 1 }} size="md" variant="primary" text={state.paused ? "Resume" : "Pause"} onPress={() => {
                        callNativeSync("deltacord.jukebox.pause", !state.paused);
                        setState(nativeState());
                    }} />
                    <Button style={{ flex: 1 }} size="md" variant="destructive" text="Stop" onPress={() => {
                        callNativeSync("deltacord.jukebox.stop");
                        setState(nativeState());
                    }} />
                </View>}

                <TableRowGroup title={`Songs and sounds (${songs.length})`}>
                    {songs.map(song => <TableRow
                        key={song.path}
                        label={song.name}
                        subLabel={song.path === state.path && active ? "Playing · long-press to remove" : `${(song.size / 1048576).toFixed(1)} MB · long-press to remove`}
                        icon={findAssetId(song.path === state.path && active ? "SpeakerIcon" : "PlayIcon") ? <TableRow.Icon source={findAssetId(song.path === state.path && active ? "SpeakerIcon" : "PlayIcon")!} /> : undefined}
                        onPress={() => play(song)}
                        onLongPress={() => removeSong(song)}
                    />)}
                    <TableRow
                        label="Add a song or sound"
                        subLabel="MP3, M4A, OGG, WAV or FLAC, up to 60 MB"
                        icon={findAssetId("PlusSmallIcon") ? <TableRow.Icon source={findAssetId("PlusSmallIcon")!} /> : undefined}
                        onPress={importSong}
                    />
                </TableRowGroup>

                <TableRowGroup title="How it sounds">
                    <TableRow
                        label="Music volume"
                        subLabel="How loud it is for everyone. Tap to change."
                        trailing={<TableRow.TrailingText text={`${Math.round(volume * 100)}%`} />}
                        onPress={cycleVolume}
                    />
                    <TableRow
                        label="Your voice"
                        subLabel="Tap to change."
                        trailing={<TableRow.TrailingText text={VOICES.find(([v]) => v === voice)?.[1] ?? "Mix with my voice"} />}
                        onPress={cycleVoice}
                    />
                    <TableSwitchRow
                        label="Hear it myself"
                        subLabel="Plays it quietly on your phone too."
                        value={jukebox.hear ?? true}
                        onValueChange={(v: boolean) => {
                            jukebox.hear = v;
                            applySettings();
                        }}
                    />
                    <TableSwitchRow
                        label="Loop"
                        subLabel="Start again from the top when it ends (applies to the next song you play)."
                        value={jukebox.loop ?? false}
                        onValueChange={(v: boolean) => void (jukebox.loop = v)}
                    />
                </TableRowGroup>

                <Text variant="text-xs/medium" color="text-muted">
                    Music sounds best with Noise Suppression off (Discord's Voice settings), since it's made to filter out anything that isn't a voice. Please only play things you're allowed to share, and be kind to the people in your call.
                </Text>
            </Stack>
        </ScrollView>
    );
}
