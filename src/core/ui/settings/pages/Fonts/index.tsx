import { importFontFile } from "@core/deltacord/fontImport";
import { Strings } from "@core/i18n";
import AddonPage from "@core/ui/components/AddonPage";
import FontEditor from "@core/ui/settings/pages/Fonts/FontEditor";
import { useProxy } from "@core/vendetta/storage";
import { FontDefinition, fonts } from "@lib/addons/fonts";
import { findAssetId } from "@lib/api/assets";
import { NativeFileModule } from "@lib/api/native/modules";
import { settings } from "@lib/api/settings";
import { NavigationNative } from "@metro/common";
import { Button, Text } from "@metro/common/components";
import { showToast } from "@ui/toasts";
import { useEffect, useState } from "react";
import { View } from "react-native";

import FontCard from "./FontCard";

const SPACING_FILE = "pyoncord/font-spacing.txt";
const SPACINGS: [string, number][] = [["Tighter", -0.08], ["Tight", -0.04], ["Normal", 0], ["Wide", 0.05]];

/** Space between letters, for all text (read by the patched app when Discord starts). */
function LetterSpacing() {
    const [value, setValue] = useState<number | null>(null);
    useEffect(() => {
        const path = `${NativeFileModule.getConstants().DocumentsDirPath}/${SPACING_FILE}`;
        NativeFileModule.fileExists(path)
            .then(async (exists: boolean) => exists ? parseFloat(await NativeFileModule.readFile(path, "utf8")) : 0)
            .then((v: number) => setValue(Number.isFinite(v) ? v : 0))
            .catch(() => setValue(0));
    }, []);
    if (value == null) return null;
    return <View style={{ gap: 6, marginTop: 8 }}>
        <Text variant="text-sm/semibold">Letter spacing</Text>
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            {SPACINGS.map(([label, v]) => <Button
                key={label}
                size="sm"
                variant={Math.abs(value - v) < 0.001 ? "primary" : "secondary"}
                text={label}
                onPress={async () => {
                    try {
                        await NativeFileModule.writeFile("documents", SPACING_FILE, String(v), "utf8");
                        setValue(v);
                        showToast("★ Saved. Close Discord fully and open it again to see it.", findAssetId("StarIcon"));
                    } catch {
                        showToast("Couldn't save the letter spacing", findAssetId("XSmallIcon"));
                    }
                }}
            />)}
        </View>
        <Text variant="text-xs/medium" color="text-muted">Determination gives every character the same width, so thin letters and apostrophes get gaps; Tight or Tighter evens them out. Works with any Deltacord font (module 1943 or newer).</Text>
    </View>;
}

export default function Fonts() {
    useProxy(settings);
    useProxy(fonts);

    const navigation = NavigationNative.useNavigation();

    return (
        <AddonPage<FontDefinition>
            title={Strings.FONTS}
            searchKeywords={["name", "description"]}
            sortOptions={{
                "Name (A-Z)": (a, b) => a.name.localeCompare(b.name),
                "Name (Z-A)": (a, b) => b.name.localeCompare(a.name)
            }}
            items={Object.values(fonts)}
            safeModeHint={{ message: Strings.SAFE_MODE_NOTICE_FONTS }}
            ListHeaderComponent={() => <View style={{ gap: 6, marginBottom: 8 }}>
                <Button
                    size="md"
                    variant="primary"
                    text="Import a font file"
                    icon={findAssetId("DownloadIcon")}
                    onPress={() => importFontFile().then(name => {
                        if (!name) return;
                        showToast(`★ ${name} is on. Close Discord fully and open it again to see it.`, findAssetId("StarIcon"));
                    }).catch((e: Error) => showToast(e.message, findAssetId("XSmallIcon")))}
                />
                <Text variant="text-xs/medium" color="text-muted">Any .ttf or .otf font from your phone, used for all of Discord's text.</Text>
                <LetterSpacing />
            </View>}
            CardComponent={FontCard}
            installAction={{
                label: "Install a font",
                onPress: () => {
                    navigation.push("BUNNY_CUSTOM_PAGE", {
                        title: "Import Font",
                        render: () => <FontEditor />
                    });
                }
            }}
        />
    );
}
