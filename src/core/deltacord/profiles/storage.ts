/**
 * Saved profiles: a list in pyoncord/deltacord-profiles/profiles.json, and each profile's
 * avatar image (as a data URI, ready to upload again) in its own file next to it.
 */
import { fileExists, readFile, removeFile, writeFile } from "@lib/api/native/fs";

export const PROFILES_DIR = "deltacord-profiles";
const LIST_FILE = `${PROFILES_DIR}/profiles.json`;
const avatarFile = (id: string) => `${PROFILES_DIR}/avatars/${id}.txt`;

/** What a profile holds. Main profiles: display name; server profiles: server nickname. */
export interface ProfileData {
    name: string | null;
    /** Discord's id for the avatar at the time it was saved (null = default avatar / no server avatar). */
    avatarHash: string | null;
    pronouns: string;
    bio: string;
    /** Profile theme: the two Nitro profile colours. */
    themeColors: number[] | null;
    /** Profile theme without Nitro: the banner colour. Main profiles only. */
    accentColor?: number | null;
}

export interface SavedProfile extends ProfileData {
    id: string;
    kind: "main" | "server";
    label: string;
    userId: string;
    guildId?: string;
    guildName?: string;
    savedAt: number;
    /** False if the avatar image couldn't be downloaded when it was saved. */
    hasAvatarImage: boolean;
}

interface ListFile {
    version: 1;
    profiles: SavedProfile[];
}

const listeners = new Set<() => void>();
export function onProfilesChanged(listener: () => void) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
}
const changed = () => listeners.forEach(l => {
    try {
        l();
    } catch { }
});

let cache: SavedProfile[] | undefined;

export async function listProfiles(): Promise<SavedProfile[]> {
    if (cache) return cache;
    try {
        if (await fileExists(LIST_FILE)) {
            const file = JSON.parse(await readFile(LIST_FILE)) as ListFile;
            if (Array.isArray(file?.profiles)) return (cache = file.profiles);
        }
    } catch (e) {
        console.error("[Profiles] Couldn't read saved profiles", e);
        // Don't let the next save wipe a damaged list; keep a copy.
        try {
            await writeFile(`${LIST_FILE}.damaged`, await readFile(LIST_FILE));
        } catch { }
    }
    return (cache = []);
}

async function writeList(profiles: SavedProfile[]) {
    cache = profiles;
    await writeFile(LIST_FILE, JSON.stringify({ version: 1, profiles } satisfies ListFile));
    changed();
}

export const newProfileId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** Adds the profile, or replaces the one with the same id. */
export async function putProfile(profile: SavedProfile, avatarDataUri: string | null) {
    if (avatarDataUri) await writeFile(avatarFile(profile.id), avatarDataUri);
    else await removeFile(avatarFile(profile.id)).catch(() => { });

    const profiles = [...await listProfiles()];
    const index = profiles.findIndex(p => p.id === profile.id);
    if (index >= 0) profiles[index] = profile;
    else profiles.push(profile);
    await writeList(profiles);
}

export async function renameProfile(id: string, label: string) {
    const profiles = (await listProfiles()).map(p => (p.id === id ? { ...p, label } : p));
    await writeList(profiles);
}

export async function deleteProfile(id: string) {
    await writeList((await listProfiles()).filter(p => p.id !== id));
    await removeFile(avatarFile(id)).catch(() => { });
}

export async function readAvatar(id: string): Promise<string | null> {
    try {
        if (await fileExists(avatarFile(id))) return await readFile(avatarFile(id));
    } catch { }
    return null;
}

/** Paths (relative to the documents folder) to include in backups. */
export async function backupPaths(): Promise<string[]> {
    const profiles = await listProfiles();
    return [`pyoncord/${LIST_FILE}`, ...profiles.filter(p => p.hasAvatarImage).map(p => `pyoncord/${avatarFile(p.id)}`)];
}

/** After a backup is restored. */
export function forgetCachedProfiles() {
    cache = undefined;
}
