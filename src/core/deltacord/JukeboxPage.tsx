/**
 * Deltacord > Jukebox: play music or sounds through your mic, so everyone in a voice call hears
 * them. The module mixes the song into what Discord reads from the microphone; this page keeps
 * your imported songs and works the controls.
 */
import { createMMKVBackend, createStorage, useProxy, wrapSync } from "@core/vendetta/storage";
import { findAssetId } from "@lib/api/assets";
import { callNative, callNativeSync } from "@lib/api/native/bridge";
import { openAlert } from "@lib/ui/alerts";
import { AlertActionButton, AlertActions, AlertModal, Button, Stack, TableRow, TableRowGroup, TableSwitchRow, Text } from "@metro/common/components";
import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";

interface Song { path: string; name: string; size: number; }

export const jukebox = wrapSync(createStorage<{
    songs?: Song[];
    /** Short sounds for the effects pad. */
    effects?: Song[];
    /** Sound effects loudness, 0-2. */
    effectsVolume?: number;
    /** Music loudness, 0-2. */
    volume?: number;
    /** Your own voice while music plays, 0-1 (0: only the music goes out). */
    voice?: number;
    /** Hear the music yourself as well. */
    hear?: boolean;
    loop?: boolean;
    /** The Jukebox button in voice call controls. */
    button?: boolean;
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
    effectsPlaying?: number;
}

const VOLUMES = [0.25, 0.5, 0.75, 1, 1.5, 2];
const VOICES: [number, string][] = [[1, "Mix with my voice"], [0.5, "My voice quieter"], [0, "Only the music"]];

function buttonStatus() {
    try {
        const { jukeboxButtonStatus: b } = require("./jukeboxButton");
        if (b.error) return `It hit a problem: ${b.error}`;
        if (b.drawn) return "It's showing in calls.";
        if (b.found) return "Discord's soundboard button was found.";
        const { seenCallParts } = require("./jukeboxButton");
        if (seenCallParts.size) return `Not found yet. Call parts seen: ${[...seenCallParts].join(", ")}`;
        return "It shows up once you're in a call with the soundboard button.";
    } catch {
        return "";
    }
}

const clock = (s = 0) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const prettyName = (name: string) => name.replace(/^picked-[a-z0-9]+-/, "").replace(/\.[a-z0-9]{2,4}$/i, "").replace(/_/g, " ");

/**
 * Calls the module: the instant connection when this phone has it, otherwise the regular one
 * (some Discord versions don't have the part the instant one goes through).
 */
async function native(method: string, ...args: any[]): Promise<any> {
    try {
        return callNativeSync(method, ...args);
    } catch {
        return await callNative(method, ...args);
    }
}

/** What's playing, or null if the module doesn't have the jukebox. */
async function nativeState(): Promise<State | null> {
    try {
        return (await native("deltacord.jukebox.state")) ?? null;
    } catch {
        return null;
    }
}

function applySettings() {
    native("deltacord.jukebox.set", jukebox.volume ?? 1, jukebox.voice ?? 1, jukebox.hear ?? true, jukebox.effectsVolume ?? 1).catch(() => { });
}

/**
 * A short message shown at the top of the Jukebox. Not Discord's pop-ups: those crashed Discord
 * when shown from a call or the Jukebox sheet.
 */
let note: { text: string; bad: boolean; at: number; } | undefined;
const say = (text: string, bad = false) => void (note = { text, bad, at: Date.now() });

function fail(e: unknown) {
    say(String((e as Error)?.message ?? e), true);
}

async function importSong() {
    try {
        const picked = await callNative("deltacord.files.pick", "audio/*", "pyoncord/jukebox", 60);
        if (!picked?.path) return;
        jukebox.songs = [...(jukebox.songs ?? []), { path: picked.path, name: prettyName(String(picked.name ?? "song")), size: Number(picked.size) || 0 }];
        say("Added to the jukebox");
    } catch (e) {
        fail(e);
    }
}

async function importEffect() {
    try {
        const picked = await callNative("deltacord.files.pick", "audio/*", "pyoncord/jukebox", 5);
        if (!picked?.path) return;
        jukebox.effects = [...(jukebox.effects ?? []), { path: picked.path, name: prettyName(String(picked.name ?? "sound")), size: Number(picked.size) || 0 }];
        say("Added to the sound effects");
    } catch (e) {
        fail(e);
    }
}

function playEffect(effect: Song, micOpen: boolean) {
    if (!micOpen) {
        say("Join a voice call with your mic on first");
        return;
    }
    applySettings();
    native("deltacord.jukebox.effect", effect.path).catch(fail);
}

function removeEffect(effect: Song) {
    openAlert("deltacord-jukebox-remove-effect", <AlertModal
        title={`Remove ${effect.name}?`}
        content="It's deleted from Deltacord. The file you imported it from stays where it was."
        actions={<AlertActions>
            <AlertActionButton text="Remove" variant="destructive" onPress={() => {
                native("deltacord.jukebox.remove", effect.path).catch(() => { });
                jukebox.effects = (jukebox.effects ?? []).filter(s => s.path !== effect.path);
            }} />
            <AlertActionButton text="Cancel" variant="secondary" />
        </AlertActions>}
    />);
}

/** The effects pad: a grid of buttons, each plays its sound through your mic straight away. */
function EffectsPad({ state, inSheet }: { state: State; inSheet: boolean; }) {
    const effects = jukebox.effects ?? [];
    const effectsVolume = jukebox.effectsVolume ?? 1;
    return <View style={{ gap: 10 }}>
        <Text variant="text-sm/bold" color="text-muted">{`SOUND EFFECTS (${effects.length})`}</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {effects.map(effect => (
                <Button
                    key={effect.path}
                    size="md"
                    variant="secondary"
                    style={{ flexGrow: 1, flexBasis: "30%" }}
                    text={effect.name.length > 16 ? `${effect.name.slice(0, 15)}…` : effect.name}
                    onPress={() => playEffect(effect, !!state.micOpen)}
                    onLongPress={() => removeEffect(effect)}
                />
            ))}
            <Button size="md" variant="primary" style={{ flexGrow: 1, flexBasis: "30%" }} text="+ Add" onPress={importEffect} />
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
            {(state.effectsPlaying ?? 0) > 0 && <Button style={{ flex: 1 }} size="sm" variant="destructive" text="Stop sounds" onPress={() => {
                native("deltacord.jukebox.stopEffects").catch(fail);
            }} />}
            <Button style={{ flex: 1 }} size="sm" variant="secondary" text={`Effects volume ${Math.round(effectsVolume * 100)}%`} onPress={() => {
                jukebox.effectsVolume = VOLUMES[(VOLUMES.indexOf(effectsVolume) + 1) % VOLUMES.length] ?? 1;
                applySettings();
            }} />
        </View>
        <Text variant="text-xs/medium" color="text-muted">
            {effects.length
                ? `Tap one to play it through your mic, on top of any music. Long-press to remove.${inSheet ? "" : " Short sounds up to 5 MB."}`
                : "Add short sounds (up to 5 MB) to play through your mic with one tap."}
        </Text>
    </View>;
}

function play(song: Song) {
    applySettings();
    native("deltacord.jukebox.play", song.path, jukebox.loop ?? false).catch(fail);
}

function removeSong(song: Song) {
    openAlert("deltacord-jukebox-remove", <AlertModal
        title={`Remove ${song.name}?`}
        content="It's deleted from Deltacord. The file you imported it from stays where it was."
        actions={<AlertActions>
            <AlertActionButton text="Remove" variant="destructive" onPress={() => {
                native("deltacord.jukebox.remove", song.path).catch(() => { });
                jukebox.songs = (jukebox.songs ?? []).filter(s => s.path !== song.path);
            }} />
            <AlertActionButton text="Cancel" variant="secondary" />
        </AlertActions>}
    />);
}

export default function JukeboxPage({ inSheet = false }: { inSheet?: boolean; }) {
    useProxy(jukebox);
    // undefined: still asking the module; null: the module doesn't have the jukebox.
    const [state, setState] = useState<State | null | undefined>(undefined);
    const refresh = () => nativeState().then(setState);

    useEffect(() => {
        applySettings();
        let alive = true;
        const tick = () => nativeState().then(next => alive && setState(next));
        tick();
        const timer = setInterval(tick, 700);
        return () => {
            alive = false;
            clearInterval(timer);
        };
    }, []);

    if (state === undefined) {
        return <View style={{ padding: 16 }}>
            <Text variant="text-md/medium" color="text-muted">Starting the jukebox…</Text>
        </View>;
    }
    if (state === null) {
        return <ScrollView contentContainerStyle={{ padding: 16, gap: 8 }}>
            <Text variant="text-md/semibold" color="text-normal">The jukebox needs Deltacord module 1.28.0 or newer.</Text>
            <Text variant="text-sm/medium" color="text-muted">Open Deltacord Manager and update the module, then restart Discord.</Text>
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
        <ScrollView style={inSheet ? { maxHeight: 560 } : { flex: 1 }} contentContainerStyle={{ paddingBottom: inSheet ? 16 : 48 }}>
            <Stack style={{ paddingVertical: inSheet ? 12 : 24, paddingHorizontal: inSheet ? 0 : 12 }} spacing={inSheet ? 14 : 20}>
                {inSheet && <Text variant="heading-lg/extrabold">Jukebox</Text>}
                <Text variant="text-sm/medium" color="text-muted">{status}</Text>
                {note && Date.now() - note.at < 5000 && <Text variant="text-sm/semibold" color={note.bad ? "text-danger" : "text-positive"}>{note.text}</Text>}

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
                        native("deltacord.jukebox.pause", !state.paused).then(refresh, fail);
                    }} />
                    <Button style={{ flex: 1 }} size="md" variant="destructive" text="Stop" onPress={() => {
                        native("deltacord.jukebox.stop").then(refresh, fail);
                    }} />
                </View>}

                <EffectsPad state={state} inSheet={inSheet} />

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
                    {!inSheet && <TableSwitchRow
                        label="Button in calls"
                        subLabel={`A Jukebox button next to the soundboard button in voice calls. ${buttonStatus()}`}
                        value={jukebox.button ?? true}
                        onValueChange={(v: boolean) => void (jukebox.button = v)}
                    />}
                    <TableSwitchRow
                        label="Loop"
                        subLabel="Start again from the top when it ends (applies to the next song you play)."
                        value={jukebox.loop ?? false}
                        onValueChange={(v: boolean) => void (jukebox.loop = v)}
                    />
                </TableRowGroup>

                {!inSheet && <Text variant="text-xs/medium" color="text-muted">
                    Music sounds best with Noise Suppression off (Discord's Voice settings), since it's made to filter out anything that isn't a voice. Please only play things you're allowed to share, and be kind to the people in your call.
                </Text>}
            </Stack>
        </ScrollView>
    );
}
