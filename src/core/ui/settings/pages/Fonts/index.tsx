import { importFontFile } from "@core/deltacord/fontImport";
import { Strings } from "@core/i18n";
import AddonPage from "@core/ui/components/AddonPage";
import FontEditor from "@core/ui/settings/pages/Fonts/FontEditor";
import { useProxy } from "@core/vendetta/storage";
import { FontDefinition, fonts } from "@lib/addons/fonts";
import { findAssetId } from "@lib/api/assets";
import { settings } from "@lib/api/settings";
import { NavigationNative } from "@metro/common";
import { Button, Text } from "@metro/common/components";
import { showToast } from "@ui/toasts";
import { View } from "react-native";

import FontCard from "./FontCard";

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
