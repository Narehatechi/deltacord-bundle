/**
 * Profiles: save your profile as it is now and put it back later. Main profiles (avatar, display
 * name, pronouns, bio, profile theme) and server profiles (the same, for one server).
 */
import { useProxy } from "@core/vendetta/storage";
import { findAssetId } from "@lib/api/assets";
import { openAlert } from "@lib/ui/alerts";
import { showToast } from "@lib/ui/toasts";
import { NavigationNative } from "@metro/common";
import { AlertActionButton, AlertActions, AlertModal, Stack, TableRow, TableRowGroup, TableSwitchRow, Text, TextInput } from "@metro/common/components";
import { findByStoreNameLazy } from "@metro/wrappers";
import { useEffect, useMemo, useState } from "react";
import { Image, ScrollView, View } from "react-native";

import { extrasSettings, getExtras } from "../extras";
import { ApplyResult, applyProfile, avatarUrl } from "./discord";
import { guildName, saveCurrentProfile } from "./index";
import { deleteProfile, listProfiles, onProfilesChanged, renameProfile, SavedProfile } from "./storage";

const GuildStore = findByStoreNameLazy("GuildStore");

const icon = (name: string) => {
    const id = findAssetId(name);
    return id ? <TableRow.Icon source={id} /> : undefined;
};

const round = (uri: string | null | undefined, size = 32) => uri
    ? <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} />
    : undefined;

const when = (ms: number) => new Date(ms).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
const short = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

let working = false;
async function withWork<T>(message: string, work: () => Promise<T>): Promise<T | undefined> {
    if (working) {
        showToast("Still working on the last one…");
        return undefined;
    }
    working = true;
    showToast(message);
    try {
        return await work();
    } catch (e: any) {
        openAlert("deltacord-profile-error", <AlertModal
            title="That didn't work"
            content={e?.message ?? String(e)}
            actions={<AlertActions><AlertActionButton text="OK" variant="secondary" /></AlertActions>}
        />);
        return undefined;
    } finally {
        working = false;
    }
}

// ------------------------------------------------------------------ prompts

function NamePrompt({ title, content, initial, confirm, onConfirm }: {
    title: string;
    content?: string;
    initial: string;
    confirm: string;
    onConfirm: (name: string) => void;
}) {
    const [value, setValue] = useState(initial);
    return (
        <AlertModal
            title={title}
            content={content}
            extraContent={<TextInput autoFocus isClearable size="md" value={value} onChange={setValue} returnKeyType="done" />}
            actions={<AlertActions>
                <AlertActionButton text={confirm} variant="primary" onPress={() => onConfirm(value.trim() || initial)} />
                <AlertActionButton text="Cancel" variant="secondary" />
            </AlertActions>}
        />
    );
}

function askName(title: string, initial: string, confirm: string, onConfirm: (name: string) => void, content?: string) {
    openAlert("deltacord-profile-name", <NamePrompt title={title} content={content} initial={initial} confirm={confirm} onConfirm={onConfirm} />);
}

function save(kind: "main" | "server", label: string, guildId?: string, replaceId?: string) {
    void withWork("Saving profile…", async () => {
        const { profile, warning } = await saveCurrentProfile({ kind, guildId, label, replaceId });
        showToast(`★ Saved "${profile.label}"`, findAssetId("StarIcon"));
        if (warning) {
            openAlert("deltacord-profile-warning", <AlertModal
                title="Saved, with one problem"
                content={warning}
                actions={<AlertActions><AlertActionButton text="OK" variant="secondary" /></AlertActions>}
            />);
        }
    });
}

function resultText(result: ApplyResult) {
    const lines: string[] = [];
    if (result.changed.length) lines.push(`Changed: ${result.changed.join(", ")}.`);
    else if (!result.failed.length) lines.push("Nothing needed changing; you're already wearing this profile.");
    if (result.failed.length) {
        lines.push("", "Couldn't change:");
        for (const f of result.failed) lines.push(`• ${f.what}: ${f.why}`);
        if (result.failed.some(f => /nitro|premium|subscri/i.test(f.why))) {
            lines.push("", "Profile themes, server avatars and server bios/pronouns need Nitro.");
        }
    }
    return lines.join("\n");
}

function load(profile: SavedProfile) {
    void withWork(`Putting on "${profile.label}"…`, async () => {
        const result = await applyProfile(profile);
        openAlert("deltacord-profile-loaded", <AlertModal
            title={result.failed.length ? "Partly loaded" : "Profile loaded"}
            content={resultText(result)}
            actions={<AlertActions><AlertActionButton text="OK" variant="secondary" /></AlertActions>}
        />);
    });
}

function describe(profile: SavedProfile) {
    const lines = [
        `${profile.kind === "server" ? "Nickname" : "Display name"}: ${profile.name || "(none)"}`,
        `Pronouns: ${profile.pronouns || "(none)"}`,
        `Bio: ${profile.bio ? short(profile.bio.replace(/\s+/g, " ")) : "(none)"}`,
        `Avatar: ${profile.avatarHash ? (profile.hasAvatarImage ? "saved" : "not saved") : profile.kind === "server" ? "your main one" : "default"}`,
        `Theme: ${profile.themeColors ? "custom colours" : profile.accentColor != null ? "banner colour" : "default"}`,
        "",
        `Saved ${when(profile.savedAt)}.`,
    ];
    if (profile.kind === "server") lines.unshift(`Server: ${guildName(profile.guildId!) ?? profile.guildName}`, "");
    return lines.join("\n");
}

function openActions(profile: SavedProfile) {
    const where = profile.kind === "server" ? ` in ${profile.guildName ?? "that server"}` : "";
    openAlert("deltacord-profile-actions", <AlertModal
        title={profile.label}
        content={describe(profile)}
        actions={<AlertActions>
            <AlertActionButton text={`Load it${where}`} variant="primary" onPress={() => load(profile)} />
            <AlertActionButton
                text="Save my current profile over it"
                variant="secondary"
                onPress={() => save(profile.kind, profile.label, profile.guildId, profile.id)}
            />
            <AlertActionButton
                text="Rename"
                variant="secondary"
                onPress={() => setTimeout(() => askName("Rename profile", profile.label, "Rename", name => void renameProfile(profile.id, name)), 300)}
            />
            <AlertActionButton
                text="Delete"
                variant="destructive"
                onPress={() => setTimeout(() => openAlert("deltacord-profile-delete", <AlertModal
                    title={`Delete "${profile.label}"?`}
                    content="Only the saved copy is deleted; your Discord profile stays as it is."
                    actions={<AlertActions>
                        <AlertActionButton text="Delete" variant="destructive" onPress={() => void deleteProfile(profile.id)} />
                        <AlertActionButton text="Cancel" variant="secondary" />
                    </AlertActions>}
                />), 300)}
            />
            <AlertActionButton text="Cancel" variant="secondary" />
        </AlertActions>}
    />);
}

// ------------------------------------------------------------------ rows

function ProfileRow({ profile }: { profile: SavedProfile; }) {
    const sub = [profile.name || (profile.kind === "server" ? "no nickname" : "no display name"), profile.pronouns]
        .filter(Boolean).join(" · ");
    return (
        <TableRow
            label={profile.label}
            subLabel={sub}
            icon={round(avatarUrl(profile.userId, profile.avatarHash, profile.guildId, 64)) ?? icon("UserIcon")}
            arrow={true}
            onPress={() => openActions(profile)}
        />
    );
}

function ServerPicker({ onPick }: { onPick: (guildId: string) => void; }) {
    const [query, setQuery] = useState("");
    const guilds = useMemo(() => {
        const all = Object.values<any>(GuildStore.getGuilds?.() ?? {});
        return all.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    }, []);
    const shown = guilds.filter(g => !query.trim() || String(g.name).toLowerCase().includes(query.trim().toLowerCase()));

    return (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 38 }} keyboardShouldPersistTaps="handled">
            <Stack style={{ paddingVertical: 24, paddingHorizontal: 12 }} spacing={16}>
                <TextInput size="md" isClearable value={query} onChange={setQuery} placeholder="Search servers" />
                <TableRowGroup title="Which server's profile?">
                    {shown.map(g => (
                        <TableRow
                            key={g.id}
                            label={g.name}
                            icon={round(g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=64` : null) ?? icon("ServerIcon")}
                            arrow={true}
                            onPress={() => onPick(g.id)}
                        />
                    ))}
                </TableRowGroup>
                {!shown.length && <Text variant="text-sm/medium" color="text-muted">No servers match.</Text>}
            </Stack>
        </ScrollView>
    );
}

// ------------------------------------------------------------------ page

export default function ProfilesPage() {
    useProxy(extrasSettings);
    const navigation = NavigationNative.useNavigation();
    const [profiles, setProfiles] = useState<SavedProfile[]>([]);

    useEffect(() => {
        const refresh = () => void listProfiles().then(p => setProfiles([...p])).catch(() => setProfiles([]));
        refresh();
        return onProfilesChanged(refresh);
    }, []);

    const main = profiles.filter(p => p.kind === "main").sort((a, b) => b.savedAt - a.savedAt);
    const servers = profiles.filter(p => p.kind === "server")
        .sort((a, b) => String(a.guildName).localeCompare(String(b.guildName)) || b.savedAt - a.savedAt);

    const saveMain = () => askName(
        "Save your profile",
        `Profile ${main.length + 1}`,
        "Save",
        name => save("main", name),
        "Saves your avatar, display name, pronouns, bio and profile theme as they are now.",
    );

    const saveServer = () => navigation.push("BUNNY_CUSTOM_PAGE", {
        title: "Pick a server",
        render: () => <ServerPicker onPick={guildId => {
            navigation.goBack();
            const name = guildName(guildId) ?? "this server";
            setTimeout(() => askName(
                "Save server profile",
                name,
                "Save",
                label => save("server", label, guildId),
                `Saves your nickname, server avatar, pronouns, bio and profile theme in ${name}.`,
            ), 350);
        }} />,
    });

    return (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 38 }}>
            <Stack style={{ paddingVertical: 24, paddingHorizontal: 12 }} spacing={24}>
                <TableRowGroup title="Main profiles">
                    <TableRow
                        label="Save my current profile"
                        subLabel="Avatar, display name, pronouns, bio and profile theme."
                        icon={icon("DownloadIcon")}
                        arrow={true}
                        onPress={saveMain}
                    />
                    {main.map(p => <ProfileRow key={p.id} profile={p} />)}
                </TableRowGroup>

                <TableRowGroup title="Server profiles">
                    <TableRow
                        label="Save a server profile"
                        subLabel="Your nickname, server avatar, pronouns, bio and theme in one server."
                        icon={icon("ServerIcon") ?? icon("DownloadIcon")}
                        arrow={true}
                        onPress={saveServer}
                    />
                    {servers.map(p => <ProfileRow key={p.id} profile={p} />)}
                </TableRowGroup>

                <TableRowGroup title="Sound">
                    <TableSwitchRow
                        label="Play the save sound"
                        subLabel="When you save a profile. You can pick your own sound in Deltacord > Extras."
                        icon={icon("BellIcon")}
                        value={getExtras().profileSaveSound}
                        onValueChange={(v: boolean) => (extrasSettings.profileSaveSound = v)}
                    />
                </TableRowGroup>

                <View style={{ gap: 6 }}>
                    <Text variant="text-xs/medium" color="text-muted">
                        Tap a saved profile to load, update, rename or delete it. Loading only changes what's different, and
                        tells you if Discord refused anything. Profile theme colours, server avatars and server bios/pronouns
                        need Nitro. Discord also limits how often you can change your avatar.
                    </Text>
                </View>
            </Stack>
        </ScrollView>
    );
}
