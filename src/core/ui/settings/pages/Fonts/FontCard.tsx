import { Strings } from "@core/i18n";
import { CardWrapper } from "@core/ui/components/AddonCard";
import { showConfirmationAlert } from "@core/vendetta/alerts";
import { useProxy } from "@core/vendetta/storage";
import { FontDefinition, fonts, selectFont } from "@lib/addons/fonts";
import { findAssetId } from "@lib/api/assets";
import { lazyDestructure } from "@lib/utils/lazy";
import { BundleUpdaterManager } from "@lib/api/native/modules";
import { createStyles, TextStyleSheet } from "@lib/ui/styles";
import { NavigationNative, tokens } from "@metro/common";
import { Button, Card, IconButton, Stack, Text } from "@metro/common/components";
import { findByProps } from "@metro";
import { useMemo, useState } from "react";
import { PixelRatio, View } from "react-native";
import { WebView } from "react-native-webview";
import previewHtml from "./preview.html";

import FontEditor from "./FontEditor";

const { useToken } = lazyDestructure(() => findByProps("useToken"));

const useStyles = createStyles({
    full: {
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%"
    }
});

const PREVIEW_STYLES = ["text-md/medium", "text-md/normal", "text-md/semibold", "text-sm/medium", "text-sm/normal"];

function previewStyle(): { fontFamily?: string; fontSize?: number; } {
    try {
        const sheet = TextStyleSheet as Record<string, { fontFamily?: string; fontSize?: number; } | undefined>;
        for (const name of PREVIEW_STYLES) if (sheet?.[name]?.fontFamily) return sheet[name]!;
        const any = Object.values(sheet ?? {}).find(style => style?.fontFamily);
        if (any) return any;
    } catch { }
    return {};
}

function FontPreview({ font }: { font: FontDefinition; }) {
    const [loaded, setLoaded] = useState(false);
    const styles = useStyles();

    const TEXT_DEFAULT = useToken(tokens.colors.TEXT_DEFAULT);
    // Discord renames its text styles now and then: use whichever body style it has, and fall
    // back to the font's first file if Discord's font isn't one this font replaces.
    const { fontFamily: fontFamilyList, fontSize } = previewStyle();
    const fontFamily = fontFamilyList?.split(/,/g)[0]?.trim() ?? "";

    const props = useMemo(() => ({
        family: font.main[fontFamily] ?? Object.values(font.main)[0],
        size: (fontSize ?? 16) * PixelRatio.getFontScale(),
        color: TEXT_DEFAULT,
        text:
            "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
    }), [font.main, fontFamily, fontSize, TEXT_DEFAULT]);

    return <View style={{ width: "100%", height: 64 }}>
        <WebView
            onMessage={() => setLoaded(true)}
            source={{
                html: previewHtml.replace("$$props", JSON.stringify(props))
            }}
            javaScriptEnabled
            scrollEnabled={false}
            overScrollMode="never"
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
            pointerEvents="none"
            style={[styles.full, { backgroundColor: "transparent", opacity: Number(loaded) }]}
        />
        {!loaded && <View style={[styles.full, { justifyContent: "center", alignItems: "center" }]}>
            <Text color="text-muted" variant="heading-lg/semibold">
                Loading...
            </Text>
        </View>}
    </View>;
}

export default function FontCard({ item: font }: CardWrapper<FontDefinition>) {
    useProxy(fonts);

    const navigation = NavigationNative.useNavigation();
    const selected = fonts.__selected === font.name;

    return (
        <Card>
            <Stack spacing={16}>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <View>
                        <Text variant="heading-lg/semibold">
                            {font.name}
                        </Text>
                        {/* TODO: Text wrapping doesn't work well */}
                        {/* <Text color="text-muted" variant="text-sm/semibold">
                            {font.description}
                        </Text> */}
                    </View>
                    <View style={{ marginLeft: "auto" }}>
                        <Stack spacing={12} direction="horizontal">
                            <IconButton
                                onPress={() => {
                                    navigation.push("BUNNY_CUSTOM_PAGE", {
                                        title: "Edit Font",
                                        render: () => <FontEditor name={font.name} />
                                    });
                                }}
                                size="sm"
                                variant="secondary"
                                disabled={selected}
                                icon={findAssetId("WrenchIcon")}
                            />
                            <Button
                                size="sm"
                                variant={selected ? "secondary" : "primary"}
                                text={selected ? "Unapply" : "Apply"}
                                onPress={async () => {
                                    await selectFont(selected ? null : font.name);
                                    showConfirmationAlert({
                                        title: Strings.HOLD_UP,
                                        content: "Reload Discord to apply changes?",
                                        confirmText: Strings.RELOAD,
                                        cancelText: Strings.CANCEL,
                                        confirmColor: "red",
                                        onConfirm: BundleUpdaterManager.reload
                                    });
                                }}
                            />
                        </Stack>
                    </View>
                </View>
                <FontPreview font={font} />
            </Stack>
        </Card>
    );
}
