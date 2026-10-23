/**
 * Reads and changes your Discord profile through the same endpoints Discord's own profile editor
 * uses (found in Discord's code):
 * - PATCH /users/@me                    display name, avatar
 * - PATCH /users/@me/profile            bio, pronouns, theme colours, banner colour
 * - PATCH /guilds/:id/members/@me       server nickname, server avatar
 * - PATCH /guilds/:id/profile/@me       server bio, pronouns, theme colours
 */
import { FluxDispatcher } from "@metro/common";
import { UserStore } from "@metro/common/stores";
import { findByProps, findByStoreNameLazy } from "@metro/wrappers";

import { download, sniffType, toBase64 } from "../bytes";
import { ProfileData, readAvatar, SavedProfile } from "./storage";

const GuildMemberStore = findByStoreNameLazy("GuildMemberStore");
const UserProfileStore = findByStoreNameLazy("UserProfileStore");

let http: any;
function HTTP() {
    http ??= findByProps("HTTP", "getAPIBaseURL")?.HTTP ?? findByProps("getAPIBaseURL", "patch");
    if (!http?.patch) throw new Error("Couldn't find Discord's network client");
    return http;
}

/** A readable reason from whatever Discord's client rejected with. */
export function describeError(error: any): string {
    const body = error?.body;
    if (body && typeof body === "object") {
        // Field errors look like { bio: ["Must be 190 or fewer in length."] }.
        for (const value of Object.values<any>(body)) {
            if (Array.isArray(value) && typeof value[0] === "string") return value[0];
        }
        if (typeof body.message === "string") return body.message;
    }
    if (typeof error?.message === "string") return error.message;
    if (error?.status) return `Discord said no (${error.status})`;
    return String(error ?? "Unknown error");
}

async function request(method: "get" | "patch", url: string, options: { body?: any; query?: any; } = {}) {
    try {
        const response = await HTTP()[method]({ url, ...options, oldFormErrors: true });
        if (response && response.ok === false) throw response;
        return response?.body;
    } catch (e) {
        throw new Error(describeError(e));
    }
}

function dispatch(action: any) {
    try {
        FluxDispatcher.dispatch(action);
    } catch { }
}

const me = () => {
    const user = UserStore.getCurrentUser?.();
    if (!user?.id) throw new Error("Not logged in yet");
    return user;
};

const norm = (s: string | null | undefined) => (s ?? "").trim();
const sameColors = (a: number[] | null | undefined, b: number[] | null | undefined) =>
    JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// ------------------------------------------------------------------ reading

/** Your profile as it is right now: everywhere (no guildId) or in one server. */
export async function readCurrent(guildId?: string): Promise<ProfileData> {
    const user = me();
    let body: any;
    try {
        body = await request("get", `/users/${user.id}/profile`, {
            query: { with_mutual_guilds: false, with_mutual_friends: false, with_mutual_friends_count: false, ...guildId ? { guild_id: guildId } : {} },
        });
    } catch (e) {
        console.warn("[Profiles] Profile fetch failed, using what Discord has loaded", e);
    }

    if (!guildId) {
        const fetchedUser = body?.user ?? {};
        const profile = body?.user_profile ?? toSnake(UserProfileStore.getUserProfile?.(user.id));
        return {
            name: fetchedUser.global_name ?? user.globalName ?? null,
            avatarHash: fetchedUser.avatar !== undefined ? fetchedUser.avatar : user.avatar ?? null,
            pronouns: profile?.pronouns ?? "",
            bio: profile?.bio ?? fetchedUser.bio ?? user.bio ?? "",
            themeColors: profile?.theme_colors ?? null,
            accentColor: profile?.accent_color ?? fetchedUser.accent_color ?? null,
        };
    }

    const member = body?.guild_member ?? GuildMemberStore.getMember?.(guildId, user.id) ?? {};
    const profile = body?.guild_member_profile ?? toSnake(UserProfileStore.getGuildMemberProfile?.(user.id, guildId));
    return {
        name: member.nick ?? null,
        avatarHash: member.avatar ?? null,
        pronouns: profile?.pronouns ?? "",
        bio: profile?.bio ?? "",
        themeColors: profile?.theme_colors ?? profile?.themeColors ?? null,
    };
}

function toSnake(profile: any) {
    if (!profile) return undefined;
    return { bio: profile.bio, pronouns: profile.pronouns, theme_colors: profile.themeColors, accent_color: profile.accentColor };
}

export function avatarUrl(userId: string, hash: string | null, guildId?: string, size = 1024): string | null {
    if (!hash) return null;
    const ext = hash.startsWith("a_") ? "gif" : "png";
    return guildId
        ? `https://cdn.discordapp.com/guilds/${guildId}/users/${userId}/avatars/${hash}.${ext}?size=${size}`
        : `https://cdn.discordapp.com/avatars/${userId}/${hash}.${ext}?size=${size}`;
}

/** Downloads an avatar as a data URI, the form Discord accepts for uploads. */
export async function downloadAvatar(userId: string, hash: string, guildId?: string): Promise<string> {
    const bytes = await download(avatarUrl(userId, hash, guildId)!);
    return `data:${sniffType(bytes, "image/png")};base64,${toBase64(bytes)}`;
}

// ------------------------------------------------------------------ applying

export interface ApplyResult {
    changed: string[];
    unchanged: string[];
    failed: { what: string; why: string; }[];
}

async function patchWithFallback(
    url: string,
    required: Record<string, any>,
    optional: Record<string, any>,
    optionalLabel: string,
    result: ApplyResult,
): Promise<any> {
    const hasRequired = Object.keys(required).length > 0;
    const hasOptional = Object.keys(optional).length > 0;
    if (!hasRequired && !hasOptional) return undefined;

    try {
        return await request("patch", url, { body: { ...required, ...optional } });
    } catch (e: any) {
        if (!hasOptional || !hasRequired) throw e;
        // Most often the optional part needs Nitro; try again without it.
        result.failed.push({ what: optionalLabel, why: e.message });
        return await request("patch", url, { body: required });
    }
}

/** Puts a saved profile on your account. Only what differs is sent. */
export async function applyProfile(saved: SavedProfile): Promise<ApplyResult> {
    const result: ApplyResult = { changed: [], unchanged: [], failed: [] };
    const user = me();
    if (saved.userId && saved.userId !== user.id) throw new Error("This profile was saved on a different account");

    const guildId = saved.kind === "server" ? saved.guildId : undefined;
    if (saved.kind === "server" && !guildId) throw new Error("This server profile has no server");

    const current = await readCurrent(guildId);
    const nameLabel = guildId ? "nickname" : "display name";

    // ---- name + avatar
    const identity: Record<string, any> = {};
    const avatar: Record<string, any> = {};
    if (norm(saved.name) !== norm(current.name)) identity[guildId ? "nick" : "global_name"] = norm(saved.name) || null;
    else result.unchanged.push(nameLabel);

    if (saved.avatarHash !== current.avatarHash) {
        if (!saved.avatarHash) avatar.avatar = null;
        else {
            const data = saved.hasAvatarImage ? await readAvatar(saved.id) : null;
            if (data) avatar.avatar = data;
            else result.failed.push({ what: "avatar", why: "the image wasn't saved with this profile" });
        }
    } else result.unchanged.push("avatar");

    try {
        const body = await patchWithFallback(
            guildId ? `/guilds/${guildId}/members/@me` : "/users/@me",
            identity, avatar, "avatar", result,
        );
        if (body) {
            if (guildId) dispatch({ type: "GUILD_MEMBER_PROFILE_UPDATE", guildMember: body, guildId });
            else dispatch({ type: "CURRENT_USER_UPDATE", user: body });
            if ("nick" in identity || "global_name" in identity) result.changed.push(nameLabel);
            if ("avatar" in avatar && !result.failed.some(f => f.what === "avatar")) result.changed.push("avatar");
        }
    } catch (e: any) {
        if (Object.keys(identity).length) result.failed.push({ what: nameLabel, why: e.message });
        if (Object.keys(avatar).length && !result.failed.some(f => f.what === "avatar")) result.failed.push({ what: "avatar", why: e.message });
    }

    // ---- bio, pronouns, theme
    const about: Record<string, any> = {};
    const theme: Record<string, any> = {};
    if (norm(saved.bio) !== norm(current.bio)) about.bio = saved.bio ?? "";
    else result.unchanged.push("bio");
    if (norm(saved.pronouns) !== norm(current.pronouns)) about.pronouns = saved.pronouns ?? "";
    else result.unchanged.push("pronouns");
    if (!sameColors(saved.themeColors, current.themeColors)) theme.theme_colors = saved.themeColors ?? null;
    if (!guildId && (saved.accentColor ?? null) !== (current.accentColor ?? null)) theme.accent_color = saved.accentColor ?? null;
    if (!Object.keys(theme).length) result.unchanged.push("profile theme");

    try {
        const body = await patchWithFallback(
            guildId ? `/guilds/${guildId}/profile/@me` : "/users/@me/profile",
            about, theme, "profile theme", result,
        );
        if (body) {
            dispatch({ type: "USER_PROFILE_UPDATE_SUCCESS", userId: user.id, guildId, ...body });
            if ("bio" in about) result.changed.push("bio");
            if ("pronouns" in about) result.changed.push("pronouns");
            if (Object.keys(theme).length && !result.failed.some(f => f.what === "profile theme")) result.changed.push("profile theme");
        }
    } catch (e: any) {
        for (const key of Object.keys(about)) result.failed.push({ what: key, why: e.message });
        if (Object.keys(theme).length && !result.failed.some(f => f.what === "profile theme")) result.failed.push({ what: "profile theme", why: e.message });
    }

    return result;
}
