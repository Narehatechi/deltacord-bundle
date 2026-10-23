import { useProxy } from "@core/vendetta/storage";
import { findAssetId } from "@lib/api/assets";
import { Button, Stack, TableRow, TableRowGroup, TableSwitchRow, Text } from "@metro/common/components";
import { ScrollView, View } from "react-native";

import { getCurrentTheme } from "@lib/addons/themes";

import { announceSave, ExtrasSettings, extrasSettings, getExtras, previewSound } from "./extras";
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
                        subLabel="Plays a short chime with it."
                        icon={icon("BellIcon")}
                        value={settings.saveChime}
                        onValueChange={set("saveChime")}
                    />
                </TableRowGroup>

                <View style={{ gap: 8 }}>
                    <Text variant="text-sm/semibold" color="text-muted">Preview</Text>
                    <Stack direction="horizontal" spacing={8}>
                        <Button size="sm" variant="secondary" text="Blip" onPress={() => previewSound("blip")} />
                        <Button size="sm" variant="secondary" text="Low blip" onPress={() => previewSound("low")} />
                        <Button size="sm" variant="secondary" text="Chime" onPress={() => previewSound("save")} />
                    </Stack>
                    <Text variant="text-xs/medium" color="text-muted">
                        All sounds are original and made for Deltacord. They play at your notification volume.
                    </Text>
                </View>
            </Stack>
        </ScrollView>
    );
}
