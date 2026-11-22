import { formatString, Strings } from "@core/i18n";
import AddonCard, { CardWrapper } from "@core/ui/components/AddonCard";
import { showConfirmationAlert } from "@core/vendetta/alerts";
import { useProxy } from "@core/vendetta/storage";
import { fetchTheme, removeTheme, selectTheme, themes, VdThemeInfo } from "@lib/addons/themes";
import { BUILTIN_THEME_IDS } from "@lib/addons/themes/builtin/deltarune";
import { isCustomThemeId } from "@lib/addons/themes/custom";
import { findAssetId } from "@lib/api/assets";
import { settings } from "@lib/api/settings";
import { clipboard, NavigationNative } from "@metro/common";
import { showToast } from "@ui/toasts";

import { openThemeEditor } from "./ThemeEditor";

function selectAndApply(value: boolean, theme: VdThemeInfo) {
    try {
        selectTheme(value ? theme : null);
    } catch (e: any) {
        console.error("Error while selectAndApply,", e);
    }
}

export default function ThemeCard({ item: theme }: CardWrapper<VdThemeInfo>) {
    useProxy(theme);

    const [removed, setRemoved] = React.useState(false);
    const navigation = NavigationNative.useNavigation();

    // This is needed because of React™
    if (removed) return null;

    const { authors } = theme.data;

    return (
        <AddonCard
            headerLabel={theme.data.name}
            headerSublabel={authors ? `by ${authors.map(i => i.name).join(", ")}` : ""}
            descriptionLabel={theme.data.description ?? "No description."}
            toggleType={!settings.safeMode?.enabled ? "radio" : undefined}
            toggleValue={() => themes[theme.id].selected}
            onToggleChange={(v: boolean) => {
                selectAndApply(v, theme);
            }}
            overflowTitle={theme.data.name}
            overflowActions={[
                ...(isCustomThemeId(theme.id) ? [{
                    icon: "PencilIcon",
                    label: "Edit in theme editor",
                    onPress: () => openThemeEditor(navigation, { editId: theme.id }),
                }] : BUILTIN_THEME_IDS.includes(theme.id) ? [{
                    icon: "PencilIcon",
                    label: "Make your own from this",
                    onPress: () => openThemeEditor(navigation, { startId: theme.id }),
                }] : []),
                {
                    icon: "RefreshIcon",
                    label: Strings.REFETCH,
                    onPress: () => {
                        fetchTheme(theme.id, theme.selected).then(() => {
                            showToast(Strings.THEME_REFETCH_SUCCESSFUL, findAssetId("DownloadIcon"));
                        }).catch(() => {
                            showToast(Strings.THEME_REFETCH_FAILED, findAssetId("XSmallIcon"));
                        });
                    },
                },
                {
                    icon: "LinkIcon",
                    label: Strings.COPY_URL,
                    onPress: () => {
                        clipboard.setString(theme.id);
                        showToast.showCopyToClipboard();
                    }
                },
                {
                    icon: "TrashIcon",
                    label: Strings.DELETE,
                    isDestructive: true,
                    onPress: () => showConfirmationAlert({
                        title: Strings.HOLD_UP,
                        content: formatString("ARE_YOU_SURE_TO_DELETE_THEME", { name: theme.data.name }),
                        confirmText: Strings.DELETE,
                        cancelText: Strings.CANCEL,
                        confirmColor: "red",
                        onConfirm: () => {
                            removeTheme(theme.id).then(wasSelected => {
                                setRemoved(true);
                                if (wasSelected) selectAndApply(false, theme);
                            }).catch((e: Error) => {
                                showToast(e.message, findAssetId("XSmallIcon"));
                            });
                        }
                    })
                },
            ]}
        />
    );
}
