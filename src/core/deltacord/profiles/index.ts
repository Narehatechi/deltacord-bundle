import { UserStore } from "@metro/common/stores";
import { findByStoreNameLazy } from "@metro/wrappers";

import { playSaveSound } from "../extras";
import { downloadAvatar, readCurrent } from "./discord";
import { newProfileId, putProfile, SavedProfile } from "./storage";

const GuildStore = findByStoreNameLazy("GuildStore");

export const guildName = (guildId: string): string | undefined => GuildStore.getGuild?.(guildId)?.name;

/**
 * Saves your profile as it is right now, as a new profile or over an existing one.
 * Returns the profile and, if the avatar image couldn't be downloaded, a warning.
 */
export async function saveCurrentProfile(options: {
    kind: "main" | "server";
    guildId?: string;
    label: string;
    replaceId?: string;
}): Promise<{ profile: SavedProfile; warning?: string; }> {
    const user = UserStore.getCurrentUser?.();
    if (!user?.id) throw new Error("Not logged in yet");
    const guildId = options.kind === "server" ? options.guildId : undefined;
    if (options.kind === "server" && !guildId) throw new Error("Pick a server first");

    const data = await readCurrent(guildId);

    let avatar: string | null = null;
    let warning: string | undefined;
    if (data.avatarHash) {
        try {
            avatar = await downloadAvatar(user.id, data.avatarHash, guildId);
        } catch (e: any) {
            warning = `The avatar image couldn't be downloaded (${e?.message ?? e}), so loading this profile won't change your avatar.`;
        }
    }

    const profile: SavedProfile = {
        ...data,
        id: options.replaceId ?? newProfileId(),
        kind: options.kind,
        label: options.label,
        userId: user.id,
        guildId,
        guildName: guildId ? guildName(guildId) ?? "Unknown server" : undefined,
        savedAt: Date.now(),
        hasAvatarImage: !!avatar,
    };
    await putProfile(profile, avatar);
    playSaveSound({ always: true });
    return { profile, warning };
}
