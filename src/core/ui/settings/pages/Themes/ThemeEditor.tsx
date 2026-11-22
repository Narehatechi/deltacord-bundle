/**
 * Deltacord's theme editor: start from a theme, change its colours, see a chat preview change as
 * you go, and save it as your own theme (fitted to every colour in your Discord version, like
 * Deltacord's built-in themes).
 */
import { saveCustomTheme } from "@lib/addons/themes";
import { Palette } from "@lib/addons/themes/builtin/deltarune";
import { cleanPalette, CustomTheme, customThemes, newCustomId, STARTERS } from "@lib/addons/themes/custom";
import { findAssetId } from "@lib/api/assets";
import { NavigationNative } from "@metro/common";
import { Button, Stack, TableRow, TableRowGroup, Text, TextInput } from "@metro/common/components";
import { showToast } from "@ui/toasts";
import chroma from "chroma-js";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

type Key = keyof Palette;

/** The colours, grouped and named the way you'd think of them. */
const GROUPS: { title: string; keys: [Key, string, string][]; }[] = [
    {
        title: "Backgrounds",
        keys: [
            ["void", "Deepest", "Behind everything, the darkest edges"],
            ["bg1", "Side panels", "Server list and the darkest panels"],
            ["bg2", "Chat", "The main chat and channel list"],
            ["bg3", "Raised", "Cards, menus, the message box"],
            ["bg4", "Hover / pressed", "What you're pressing or have selected"],
            ["bg5", "Borders", "Dividers and the brightest panels"],
        ],
    },
    {
        title: "Text",
        keys: [
            ["text", "Text", "Messages and names"],
            ["muted", "Secondary text", "Channel names, timestamps, hints"],
            ["faint", "Faint text", "Placeholders and less important text"],
            ["disabled", "Disabled", "Things you can't use right now"],
        ],
    },
    {
        title: "Accents",
        keys: [
            ["accent", "Accent", "Buttons, the brand colour, progress bars"],
            ["yellow", "Selected", "Whatever's selected (yellow in Discord)"],
            ["cyan", "Links", "Links and info"],
            ["red", "Danger", "Errors, delete, mentions badge, Do Not Disturb"],
            ["green", "Success", "Online, success, joined"],
            ["orange", "Warning", "Warnings and Idle"],
            ["pink", "Pink", "Pink roles and highlights"],
            ["purple", "Purple", "Purple roles, boosts, Nitro"],
            ["teal", "Teal", "Teal roles and highlights"],
        ],
    },
];

/** Swatches: each hue at four shades, plus greys. */
const SWATCHES: string[] = (() => {
    const out: string[] = [];
    for (const l of [0.25, 0.45, 0.65, 0.82]) {
        for (let h = 0; h < 360; h += 30) out.push(chroma.hsl(h, l > 0.7 ? 0.9 : 0.75, l).hex());
    }
    for (const l of [0, 0.04, 0.08, 0.13, 0.2, 0.3, 0.45, 0.6, 0.75, 0.88, 0.95, 1]) out.push(chroma.hsl(0, 0, l).hex());
    return out;
})();

const readable = (bg: string) => chroma.contrast(bg, "#000000") > chroma.contrast(bg, "#FFFFFF") ? "#000000" : "#FFFFFF";

function Swatch({ color, size = 28, selected, onPress }: { color: string; size?: number; selected?: boolean; onPress?: () => void; }) {
    return (
        <Pressable
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel={color}
            style={{ width: size, height: size, borderRadius: 6, backgroundColor: color, borderWidth: selected ? 3 : 1, borderColor: selected ? readable(color) : "rgba(128,128,128,0.5)" }}
        />
    );
}

/** A small chat drawn with the palette, so you see the theme while you make it. */
function Preview({ p, name }: { p: Palette; name: string; }) {
    const box = { borderRadius: 10, overflow: "hidden" as const, borderWidth: 1, borderColor: p.bg5 };
    return (
        <View style={box}>
            <View style={{ flexDirection: "row" }}>
                <View style={{ width: 46, backgroundColor: p.bg1, paddingVertical: 10, alignItems: "center", gap: 8 }}>
                    {[p.accent, p.purple, p.green].map((c, i) => <View key={i} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: c }} />)}
                </View>
                <View style={{ flex: 1, backgroundColor: p.bg2 }}>
                    <View style={{ paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: p.bg5, backgroundColor: p.bg2 }}>
                        <Text variant="text-md/bold" style={{ color: p.text }}># {name || "your-theme"}</Text>
                    </View>
                    <View style={{ padding: 12, gap: 10 }}>
                        <View style={{ flexDirection: "row", gap: 8 }}>
                            <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: p.pink }} />
                            <View style={{ flex: 1 }}>
                                <Text variant="text-sm/semibold" style={{ color: p.text }}>Kris <Text variant="text-xs/medium" style={{ color: p.faint }}>Today at 8:45</Text></Text>
                                <Text variant="text-sm/medium" style={{ color: p.text }}>Look at this <Text variant="text-sm/medium" style={{ color: p.cyan }}>link</Text></Text>
                            </View>
                        </View>
                        <View style={{ flexDirection: "row", gap: 8, backgroundColor: chroma(p.yellow).alpha(0.12).css(), borderLeftWidth: 2, borderLeftColor: p.yellow, marginHorizontal: -12, paddingHorizontal: 10, paddingVertical: 4 }}>
                            <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: p.green }} />
                            <View style={{ flex: 1 }}>
                                <Text variant="text-sm/semibold" style={{ color: p.text }}>Susie</Text>
                                <Text variant="text-sm/medium" style={{ color: p.text }}><Text variant="text-sm/semibold" style={{ color: p.accent, backgroundColor: chroma(p.accent).alpha(0.2).css() }}>@you</Text> it's mentioning you</Text>
                            </View>
                        </View>
                        <Text variant="text-xs/medium" style={{ color: p.muted }}>Secondary text · <Text variant="text-xs/medium" style={{ color: p.red }}>danger</Text> · <Text variant="text-xs/medium" style={{ color: p.green }}>online</Text> · <Text variant="text-xs/medium" style={{ color: p.orange }}>warning</Text></Text>
                        <View style={{ flexDirection: "row", gap: 8 }}>
                            <View style={{ backgroundColor: p.accent, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 6 }}>
                                <Text variant="text-sm/semibold" style={{ color: readable(p.accent) }}>Button</Text>
                            </View>
                            <View style={{ backgroundColor: p.bg4, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 6 }}>
                                <Text variant="text-sm/semibold" style={{ color: p.text }}>Other</Text>
                            </View>
                        </View>
                    </View>
                    <View style={{ margin: 10, marginTop: 0, backgroundColor: p.bg3, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10 }}>
                        <Text variant="text-sm/medium" style={{ color: p.faint }}>Message #{name || "your-theme"}</Text>
                    </View>
                </View>
            </View>
        </View>
    );
}

/** One colour: its swatch and name; tap to open the picker under it. */
function ColorRow({ k, label, hint, value, open, onOpen, onChange }: {
    k: Key; label: string; hint: string; value: string; open: boolean; onOpen: () => void; onChange: (v: string) => void;
}) {
    const [hex, setHex] = useState(value);
    const shift = (amount: number) => {
        const next = amount > 0 ? chroma(value).brighten(amount).hex() : chroma(value).darken(-amount).hex();
        onChange(next);
        setHex(next);
    };
    return (
        <View>
            <TableRow
                label={label}
                subLabel={`${hint} · ${value.toUpperCase()}`}
                onPress={onOpen}
                trailing={<View pointerEvents="none"><Swatch color={value} size={30} /></View>}
            />
            {open && <View style={{ paddingHorizontal: 12, paddingBottom: 14, gap: 10 }}>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                    {SWATCHES.map(c => <Swatch key={c} color={c} selected={c.toLowerCase() === value.toLowerCase()} onPress={() => { onChange(c); setHex(c); }} />)}
                </View>
                <Stack direction="horizontal" spacing={8}>
                    <Button size="sm" variant="secondary" text="Darker" onPress={() => shift(-0.4)} />
                    <Button size="sm" variant="secondary" text="Lighter" onPress={() => shift(0.4)} />
                </Stack>
                <TextInput
                    size="md"
                    value={hex}
                    placeholder="#RRGGBB"
                    autoCapitalize="none"
                    onChange={(v: string) => {
                        setHex(v);
                        const t = v.trim();
                        if (/^#?[0-9a-f]{6}$/i.test(t)) onChange(chroma(t.startsWith("#") ? t : `#${t}`).hex());
                    }}
                />
            </View>}
        </View>
    );
}

export default function ThemeEditor({ editId, startId }: { editId?: string; startId?: string; }) {
    const navigation = NavigationNative.useNavigation();
    const existing = editId ? customThemes[editId] : undefined;
    const starter = STARTERS.find(s => s.id === startId) ?? STARTERS[0];

    const [name, setName] = useState(existing?.name ?? (startId ? `My ${starter.name}` : "My Theme"));
    const [palette, setPalette] = useState<Palette>(cleanPalette(existing?.palette ?? starter.palette));
    const [base, setBase] = useState(existing?.base ?? starter.id);
    const [bgUrl, setBgUrl] = useState(existing ? existing.background?.url ?? "" : starter.background?.url ?? "");
    const [bgAlpha, setBgAlpha] = useState(existing ? existing.background?.alpha ?? 0.3 : starter.background?.alpha ?? 0.3);
    const [open, setOpen] = useState<Key | null>(null);
    const [busy, setBusy] = useState(false);

    const set = (k: Key) => (v: string) => setPalette(p => ({ ...p, [k]: v }));

    const startFrom = (id: string) => {
        const starter = STARTERS.find(s => s.id === id);
        if (!starter) return;
        setBase(id);
        setPalette(cleanPalette(starter.palette));
        setBgUrl(starter.background?.url ?? "");
        setBgAlpha(starter.background?.alpha ?? 0.3);
    };

    const save = async () => {
        if (!name.trim()) return showToast("Give your theme a name first", findAssetId("XSmallIcon"));
        if (bgUrl.trim() && !/^https:\/\//i.test(bgUrl.trim())) return showToast("The background needs a link starting with https://", findAssetId("XSmallIcon"));
        setBusy(true);
        try {
            const theme: CustomTheme = {
                id: existing?.id ?? newCustomId(name),
                name: name.trim(),
                palette,
                base,
                background: bgUrl.trim() ? { url: bgUrl.trim(), alpha: bgAlpha } : null,
            };
            await saveCustomTheme(theme);
            showToast(`★ ${theme.name} saved and on`, findAssetId("StarIcon"));
            navigation.goBack();
        } catch (e: any) {
            showToast(`Couldn't save: ${e?.message ?? e}`, findAssetId("XSmallIcon"));
        } finally {
            setBusy(false);
        }
    };

    const contrast = useMemo(() => chroma.contrast(palette.text, palette.bg2), [palette.text, palette.bg2]);

    return (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}>
            <Preview p={palette} name={name.toLowerCase().replace(/\s+/g, "-")} />
            {contrast < 4.5 && <Text variant="text-xs/semibold" color="text-danger">
                Text on the chat background is hard to read ({contrast.toFixed(1)}:1). Try a lighter Text or a darker Chat colour.
            </Text>}

            <TextInput size="md" label="Name" value={name} onChange={setName} placeholder="My Theme" />

            <TableRowGroup title="Start from">
                {STARTERS.map(s => <TableRow
                    key={s.id}
                    label={s.name}
                    subLabel={s.id === base ? "Started from this one" : "Replaces your colours with this theme's"}
                    onPress={() => startFrom(s.id)}
                    trailing={<View style={{ flexDirection: "row", gap: 4 }} pointerEvents="none">
                        {[s.palette.bg2, s.palette.text, s.palette.accent, s.palette.red].map((c, i) => <Swatch key={i} color={c} size={18} />)}
                    </View>}
                />)}
            </TableRowGroup>

            {GROUPS.map(group => <TableRowGroup key={group.title} title={group.title}>
                {group.keys.map(([k, label, hint]) => <ColorRow
                    key={k}
                    k={k}
                    label={label}
                    hint={hint}
                    value={palette[k]}
                    open={open === k}
                    onOpen={() => setOpen(open === k ? null : k)}
                    onChange={set(k)}
                />)}
            </TableRowGroup>)}

            <TableRowGroup title="Background picture">
                <View style={{ padding: 12, gap: 10 }}>
                    <Text variant="text-xs/medium" color="text-muted">A picture behind the chat. Paste a link to an image (a Discord attachment link works), or leave it empty for none.</Text>
                    <TextInput size="md" value={bgUrl} onChange={setBgUrl} placeholder="https://…/background.png" isClearable={true} autoCapitalize="none" />
                    <Stack direction="horizontal" spacing={8}>
                        {[0.15, 0.3, 0.5, 0.75].map(a => <Button key={a} size="sm" variant={Math.abs(bgAlpha - a) < 0.01 ? "primary" : "secondary"} text={`${Math.round(a * 100)}%`} onPress={() => setBgAlpha(a)} />)}
                    </Stack>
                </View>
            </TableRowGroup>

            <Button size="lg" variant="primary" text={busy ? "Saving…" : existing ? "Save changes" : "Save and use this theme"} disabled={busy} onPress={save} />
            <Text variant="text-xs/medium" color="text-muted">
                Saved themes are fitted to every colour in your Discord version and appear in Themes, where you can switch, edit or delete them.
            </Text>
        </ScrollView>
    );
}

/** Opens the theme editor (a new theme, one to edit, or one starting from a built-in theme). */
export function openThemeEditor(navigation: any, opts: { editId?: string; startId?: string; } = {}) {
    navigation.push("BUNNY_CUSTOM_PAGE", {
        title: opts.editId ? "Edit theme" : "Theme editor",
        render: () => <ThemeEditor {...opts} />,
    });
}
