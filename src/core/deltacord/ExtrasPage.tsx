import { useProxy } from "@core/vendetta/storage";
import { findAssetId } from "@lib/api/assets";
import { showToast } from "@lib/ui/toasts";
import { Button, Stack, TableRow, TableRowGroup, TableSwitchRow, Text, TextInput } from "@metro/common/components";
import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";

import { getCurrentTheme } from "@lib/addons/themes";
import { NativeFileModule } from "@lib/api/native/modules";
import { NavigationNative } from "@metro/common";

import { announceSave, ExtrasSettings, extrasSettings, getExtras, previewSound, resetSaveSound, setCustomSaveSound } from "./extras";
import { promptReload, syncThemeFont } from "./themeFont";

const icon = (name: string) => {
    const id = findAssetId(name);
    return id ? <TableRow.Icon source={id} /> : undefined;
};

export default function ExtrasPage() {
    useProxy(extrasSettings);
    const settings = getExtras();
    const set = (key: keyof ExtrasSettings) => (value: boolean) => {
        extrasSettings[key] = value;
        announceSave();
    };

    return (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 38 }}>
            <Stack style={{ paddingVertical: 24, paddingHorizontal: 12 }} spacing={24}>
                <StartupAnimationSwitch />

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

                <SaveSoundPicker />

                <View style={{ gap: 8 }}>
                    <Text variant="text-sm/semibold" color="text-muted">Preview</Text>
                    <Stack direction="horizontal" spacing={8}>
                        <Button size="sm" variant="secondary" text="Blip" onPress={() => previewSound("blip")} />
                        <Button size="sm" variant="secondary" text="Low blip" onPress={() => previewSound("low")} />
                        <Button size="sm" variant="secondary" text="Chime" onPress={() => previewSound("save")} />
                    </Stack>
                    <Text variant="text-xs/medium" color="text-muted">
                        Deltacord's own sounds are original. They play at your notification volume.
                    </Text>
                </View>
            </Stack>
        </ScrollView>
    );
}

function SaveSoundPicker() {
    useProxy(extrasSettings);
    const { saveSoundUrl } = getExtras();
    const [link, setLink] = useState(saveSoundUrl ?? "");
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);

    const use = async () => {
        setBusy(true);
        setError("");
        try {
            await setCustomSaveSound(link);
            showToast("★ Save sound set", findAssetId("StarIcon"));
        } catch (e: any) {
            setError(e?.message ?? String(e));
        } finally {
            setBusy(false);
        }
    };

    return (
        <View style={{ gap: 8 }}>
            <Text variant="text-sm/semibold" color="text-muted">Save sound</Text>
            <Text variant="text-xs/medium" color="text-muted">
                {saveSoundUrl
                    ? "Using your own sound for saves (profile saves, and other saves with Save chime on)."
                    : "Using Deltacord's chime. To use your own, paste a link to a short WAV, MP3 or OGG file. A Discord attachment link works: send the file to yourself, long-press it and copy the link. It's downloaded once and kept on your phone."}
            </Text>
            <TextInput
                size="md"
                value={link}
                placeholder="https://…/sound.wav"
                isClearable={true}
                onChange={(v: string) => {
                    setLink(v);
                    if (error) setError("");
                }}
                returnKeyType="done"
                onSubmitEditing={use}
                state={error ? "error" : undefined}
                errorMessage={error || undefined}
            />
            <Stack direction="horizontal" spacing={8}>
                <Button size="sm" variant="primary" text={busy ? "Downloading…" : "Use this sound"} disabled={busy || !link.trim()} onPress={use} />
                {saveSoundUrl && <Button size="sm" variant="secondary" text="Back to Deltacord's chime" onPress={() => {
                    resetSaveSound();
                    setLink("");
                }} />}
            </Stack>
        </View>
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
                subLabel="DEL, TA, CORD instead of Discord's logo while it starts. Changes on the next launch."
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
