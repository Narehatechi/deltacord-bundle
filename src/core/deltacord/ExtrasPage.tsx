import { useProxy } from "@core/vendetta/storage";
import { findAssetId } from "@lib/api/assets";
import { showToast } from "@lib/ui/toasts";
import { Button, Stack, TableRadioGroup, TableRadioRow, TableRow, TableRowGroup, TableSwitchRow, Text, TextInput } from "@metro/common/components";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { getCurrentTheme } from "@lib/addons/themes";
import { NativeFileModule } from "@lib/api/native/modules";
import { NavigationNative } from "@metro/common";

import DiscordSoundsPage from "./DiscordSoundsPage";
import { announceSave, customSound, ExtrasSettings, extrasSettings, getExtras, importSoundFile, importSoundLink, previewSound, resetEffect, SoundEffect } from "./extras";
import HideThingsPage from "./HideThingsPage";
import { promptReload, syncThemeFont } from "./themeFont";

const icon = (name: string) => {
    const id = findAssetId(name);
    return id ? <TableRow.Icon source={id} /> : undefined;
};

export default function ExtrasPage() {
    useProxy(extrasSettings);
    const navigation = NavigationNative.useNavigation();
    const settings = getExtras();
    const set = (key: keyof ExtrasSettings) => (value: boolean) => {
        (extrasSettings as Record<string, unknown>)[key] = value;
        announceSave();
    };

    return (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 38 }}>
            <Stack style={{ paddingVertical: 24, paddingHorizontal: 12 }} spacing={24}>
                <StartupAnimationSwitch />
                <StartupStylePicker />
                <StartupAnimationEditor />

                <TableRowGroup title="Font">
                    <TableSwitchRow
                        label="Determination font with Deltacord's themes"
                        subLabel="Deltarune, Light World and Crimson switch Discord's font to Determination. Other themes keep yours."
                        icon={icon("TextIcon") ?? icon("StarIcon")}
                        value={settings.themeFont}
                        onValueChange={async (v: boolean) => {
                            extrasSettings.themeFont = v;
                            announceSave();
                            try {
                                if (await syncThemeFont(getCurrentTheme()?.id, { quiet: true })) promptReload();
                            } catch { }
                        }}
                    />
                </TableRowGroup>

                <TableRowGroup title="Text blips">
                    <TableSwitchRow
                        label="Blip on new messages"
                        subLabel="A soft 8-bit blip when someone posts in the channel you're looking at."
                        icon={icon("ChatIcon")}
                        value={settings.textBlips}
                        onValueChange={set("textBlips")}
                    />
                    <TableSwitchRow
                        label="Lower blip"
                        subLabel="A deeper, quieter blip."
                        icon={icon("VoiceNormalIcon") ?? icon("ChatIcon")}
                        value={settings.lowBlips}
                        onValueChange={set("lowBlips")}
                    />
                </TableRowGroup>

                <TableRowGroup title="Saving">
                    <TableSwitchRow
                        label="★ Saved messages"
                        subLabel="A little star toast when you change themes, fonts or Deltacord settings."
                        icon={icon("StarIcon")}
                        value={settings.saveToasts}
                        onValueChange={set("saveToasts")}
                    />
                    <TableSwitchRow
                        label="Save chime"
                        subLabel="Plays the save sound with it."
                        icon={icon("BellIcon")}
                        value={settings.saveChime}
                        onValueChange={set("saveChime")}
                    />
                </TableRowGroup>

                <Text variant="text-sm/semibold" color="text-muted">Sound effects</Text>
                <Text variant="text-xs/medium" color="text-muted">
                    Swap any of Deltacord's sounds for your own: pick a WAV, MP3 or OGG file from your phone, or paste a link (a Discord attachment link works). Short sounds work best. They play at your notification volume.
                </Text>
                <SoundSlot effect="blip" title="Blip" what="When someone sends a message (Text blips)" builtin="Deltacord's blip" />
                <SoundSlot effect="low" title="Low blip" what="The blip with Low blips on" builtin="Deltacord's low blip" />
                <SoundSlot effect="save" title="Save chime" what="Saving a profile, and other saves with Save chime on" builtin="Deltacord's chime" />
                <TableRowGroup title="Look">
                    <TableRow
                        label="Hide anything"
                        subLabel="Switch off any of Discord's buttons, banners, tips and Nitro, Shop and Quest upsells."
                        icon={icon("EyeSlashIcon") ?? icon("EyeIcon")}
                        arrow={true}
                        onPress={() => navigation.push("BUNNY_CUSTOM_PAGE", {
                            title: "Hide anything",
                            render: () => <HideThingsPage />,
                        })}
                    />
                </TableRowGroup>
                <TableRowGroup title="Discord's sounds">
                    <TableRow
                        label="Replace Discord's sounds"
                        subLabel="Message, mention, calls, joining and leaving voice, mute and more: use your own or make them silent."
                        icon={icon("BellIcon")}
                        arrow={true}
                        onPress={() => navigation.push("BUNNY_CUSTOM_PAGE", {
                            title: "Discord's sounds",
                            render: () => <DiscordSoundsPage />,
                        })}
                    />
                </TableRowGroup>
            </Stack>
        </ScrollView>
    );
}

/** One Deltacord sound effect: what plays now, play it, and swap it for a file or a link. */
function SoundSlot({ effect, title, what, builtin }: { effect: SoundEffect; title: string; what: string; builtin: string; }) {
    useProxy(extrasSettings);
    const own = customSound(effect);
    const [linking, setLinking] = useState(false);
    const [link, setLink] = useState("");
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);

    const run = async (job: () => Promise<unknown>, done: string) => {
        setBusy(true);
        setError("");
        try {
            if (await job() !== false) {
                showToast(`★ ${done}`, findAssetId("StarIcon"));
                setLinking(false);
                setLink("");
            }
        } catch (e: any) {
            setError(e?.message ?? String(e));
        } finally {
            setBusy(false);
        }
    };

    return (
        <TableRowGroup title={title}>
            <TableRow
                label={own ? own.name : builtin}
                subLabel={`${own ? "Your sound" : "Built in"} · ${what}`}
                icon={<TableRow.Icon source={findAssetId(effect === "save" ? "StarIcon" : "ChatIcon")} />}
                trailing={<Button size="sm" variant="secondary" text="Play" onPress={() => previewSound(effect)} />}
            />
            <View style={{ padding: 12, gap: 8 }}>
                {linking && <TextInput
                    size="md"
                    value={link}
                    placeholder="https://…/sound.wav"
                    isClearable={true}
                    onChange={(v: string) => {
                        setLink(v);
                        if (error) setError("");
                    }}
                    returnKeyType="done"
                    onSubmitEditing={() => link.trim() && run(() => importSoundLink(effect, link), `${title} set`)}
                    state={error ? "error" : undefined}
                    errorMessage={error || undefined}
                />}
                {!linking && !!error && <Text variant="text-xs/medium" color="text-danger">{error}</Text>}
                <Stack direction="horizontal" spacing={8}>
                    {linking
                        ? <Button size="sm" variant="primary" text={busy ? "Downloading…" : "Use this link"} disabled={busy || !link.trim()} onPress={() => run(() => importSoundLink(effect, link), `${title} set`)} />
                        : <Button size="sm" variant="primary" text={busy ? "Importing…" : "Pick a file"} disabled={busy} onPress={() => run(() => importSoundFile(effect), `${title} set`)} />}
                    <Button size="sm" variant="secondary" text={linking ? "Cancel" : "Use a link"} disabled={busy} onPress={() => {
                        setLinking(!linking);
                        setError("");
                    }} />
                    {own && !linking && <Button size="sm" variant="secondary" text="Reset" disabled={busy} onPress={() => {
                        resetEffect(effect);
                        showToast(`${title}: back to ${builtin}`, findAssetId("StarIcon"));
                    }} />}
                </Stack>
            </View>
        </TableRowGroup>
    );
}

/** The startup animation is drawn by the patched app itself, which looks for this file. */
const ANIMATION_OFF_FILE = "pyoncord/startup-animation-off";

function StartupAnimationSwitch() {
    const [on, setOn] = useState(true);
    useEffect(() => {
        const path = `${NativeFileModule.getConstants().DocumentsDirPath}/${ANIMATION_OFF_FILE}`;
        NativeFileModule.fileExists(path).then((off: boolean) => setOn(!off)).catch(() => { });
    }, []);

    return (
        <TableRowGroup title="Startup">
            <TableSwitchRow
                label="Startup animation"
                subLabel="DELTACORD instead of Discord's logo while it starts. Changes on the next launch."
                icon={icon("StarIcon")}
                value={on}
                onValueChange={async (value: boolean) => {
                    setOn(value);
                    try {
                        if (value) await NativeFileModule.removeFile?.("documents", ANIMATION_OFF_FILE);
                        else await NativeFileModule.writeFile("documents", ANIMATION_OFF_FILE, "off", "utf8");
                        announceSave();
                    } catch {
                        setOn(!value);
                    }
                }}
            />
            <CrashPreviewRow />
        </TableRowGroup>
    );
}

/** Which startup animation plays; the patched app reads this file at launch. */
const ANIMATION_STYLE_FILE = "pyoncord/startup-animation-style";

const ANIMATION_STYLES: [string, string][] = [
    ["random", "Random (a different one each launch)"],
    ["upgraded", "Upgraded"],
    ["fountain", "Dark Fountain"],
    ["soul", "SOUL"],
    ["battle", "Battle encounter"],
    ["crt", "Old TV"],
    ["savepoint", "Save Point"],
    ["drop", "Letter Drop"],
    ["warp", "Warp"],
    ["door", "The Door"],
    ["neon", "Neon Sign"],
    ["dither", "Pixel Build"],
    ["orbit", "Seven SOULs"],
    ["rain", "Glyph Rain"],
    ["fireworks", "Fireworks"],
];

function StartupStylePicker() {
    const [style, setStyle] = useState<string | null>(null);
    useEffect(() => {
        const path = `${NativeFileModule.getConstants().DocumentsDirPath}/${ANIMATION_STYLE_FILE}`;
        NativeFileModule.fileExists(path)
            .then(async (exists: boolean) => exists ? (await NativeFileModule.readFile(path, "utf8")).trim() : "upgraded")
            .then((value: string) => setStyle(ANIMATION_STYLES.some(([id]) => id === value) ? value : "upgraded"))
            .catch(() => setStyle("upgraded"));
    }, []);

    if (!style) return null;
    return (
        <TableRadioGroup
            title="Startup animation style"
            defaultValue={style}
            onChange={async (value: string) => {
                setStyle(value);
                try {
                    await NativeFileModule.writeFile("documents", ANIMATION_STYLE_FILE, value, "utf8");
                    showToast("Plays on the next launch");
                } catch {
                    showToast("Couldn't save the animation style");
                }
            }}
        >
            {ANIMATION_STYLES.map(([id, label]) => <TableRadioRow key={id} label={label} value={id} />)}
        </TableRadioGroup>
    );
}

/** Your own word, credit line and colours for the startup animation (read by the patched app at launch). */
const ANIMATION_FILE = "pyoncord/startup-animation.json";

const ANIMATION_COLOURS = ["#FFFFFF", "#FFE14D", "#FF4D5E", "#FF8A00", "#33DD55", "#4DFCFF", "#3366FF", "#B48CFF", "#FF4DE1", "#F29AC2", "#FFCC33", "#8C8C8C"];

interface AnimationConfig { text: string; credit: string; colors: "random" | "custom"; glow: string; sparks: string[]; }
const DEFAULT_ANIMATION: AnimationConfig = { text: "", credit: "", colors: "random", glow: "#FFFFFF", sparks: ["#FFFFFF", "#FFE14D", "#4DFCFF", "#FF4DE1"] };

function ColourChoice({ value, onChange }: { value: string; onChange: (v: string) => void; }) {
    return (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {ANIMATION_COLOURS.map(c => <Pressable
                key={c}
                accessibilityRole="button"
                accessibilityLabel={c}
                onPress={() => onChange(c)}
                style={{ width: 28, height: 28, borderRadius: 6, backgroundColor: c, borderWidth: value.toUpperCase() === c ? 3 : 1, borderColor: value.toUpperCase() === c ? "#888888" : "rgba(128,128,128,0.4)" }}
            />)}
        </View>
    );
}

function StartupAnimationEditor() {
    const [config, setConfig] = useState<AnimationConfig | null>(null);
    const [spark, setSpark] = useState(0);
    useEffect(() => {
        const path = `${NativeFileModule.getConstants().DocumentsDirPath}/${ANIMATION_FILE}`;
        NativeFileModule.fileExists(path)
            .then(async (exists: boolean) => exists ? JSON.parse(await NativeFileModule.readFile(path, "utf8")) : {})
            .then((saved: Partial<AnimationConfig>) => setConfig({ ...DEFAULT_ANIMATION, ...saved, sparks: (saved.sparks?.length ? saved.sparks : DEFAULT_ANIMATION.sparks).slice(0, 4) }))
            .catch(() => setConfig(DEFAULT_ANIMATION));
    }, []);
    if (!config) return null;

    const update = (change: Partial<AnimationConfig>) => setConfig({ ...config, ...change });
    const save = async (next = config) => {
        try {
            await NativeFileModule.writeFile("documents", ANIMATION_FILE, JSON.stringify(next), "utf8");
            showToast("★ Saved · plays on the next launch", findAssetId("StarIcon"));
        } catch {
            showToast("Couldn't save the animation", findAssetId("XSmallIcon"));
        }
    };

    return (
        <TableRowGroup title="Your startup animation">
            <View style={{ padding: 12, gap: 10 }}>
                <Text variant="text-xs/medium" color="text-muted">Make the startup animation yours. Changes play the next time Discord opens (they need module 1941 or newer).</Text>
                <TextInput size="md" label="Word" value={config.text} placeholder="DELTACORD" autoCapitalize="characters" maxLength={14} onChange={(v: string) => update({ text: v.toUpperCase() })} />
                <TextInput size="md" label="Credit line" value={config.credit} placeholder="by Narehatechi" maxLength={30} onChange={(v: string) => update({ credit: v })} />
                <Text variant="text-sm/semibold">Colours</Text>
                <Stack direction="horizontal" spacing={8}>
                    <Button size="sm" variant={config.colors === "random" ? "primary" : "secondary"} text="Random each launch" onPress={() => update({ colors: "random" })} />
                    <Button size="sm" variant={config.colors === "custom" ? "primary" : "secondary"} text="My colours" onPress={() => update({ colors: "custom" })} />
                </Stack>
                {config.colors === "custom" && <View style={{ gap: 10 }}>
                    <Text variant="text-xs/semibold" color="text-muted">Glow</Text>
                    <ColourChoice value={config.glow} onChange={glow => update({ glow })} />
                    <Text variant="text-xs/semibold" color="text-muted">Sparkles (tap one to change it)</Text>
                    <View style={{ flexDirection: "row", gap: 8 }}>
                        {config.sparks.map((c, i) => <Pressable
                            key={i}
                            accessibilityRole="button"
                            accessibilityLabel={`Sparkle colour ${i + 1}`}
                            onPress={() => setSpark(i)}
                            style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: c, borderWidth: spark === i ? 3 : 1, borderColor: spark === i ? "#888888" : "rgba(128,128,128,0.4)" }}
                        />)}
                    </View>
                    <ColourChoice value={config.sparks[spark]} onChange={c => update({ sparks: config.sparks.map((s, i) => i === spark ? c : s) })} />
                </View>}
                <Stack direction="horizontal" spacing={8}>
                    <Button size="sm" variant="primary" text="Save" onPress={() => save()} />
                    <Button size="sm" variant="secondary" text="Back to Deltacord's" onPress={() => {
                        setConfig(DEFAULT_ANIMATION);
                        void save(DEFAULT_ANIMATION);
                    }} />
                </Stack>
            </View>
        </TableRowGroup>
    );
}

/** Shows the crash screen without anything crashing (Continue goes back). */
function CrashPreviewRow() {
    const navigation = NavigationNative.useNavigation();
    return (
        <TableRow
            arrow
            label="Preview the crash screen"
            subLabel="See what shows if something breaks. Continue brings you back."
            icon={icon("WarningIcon")}
            onPress={() => {
                const ErrorBoundaryScreen = require("@core/ui/reporter/components/ErrorBoundaryScreen").default;
                const error = Object.assign(new Error("This is only a preview. Nothing actually broke."), { stack: "" });
                navigation.push("BUNNY_CUSTOM_PAGE", {
                    title: "Crash screen preview",
                    render: () => <ErrorBoundaryScreen error={error} rerender={() => navigation.goBack()} />,
                });
            }}
        />
    );
}
