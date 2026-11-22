/**
 * Hide anything: any of Discord's buttons, banners, tips and Nitro/Shop/Quest upsells, by name.
 *
 * As Discord loads its parts, Deltacord notes the ones whose names say they're buttons, banners,
 * tips or upsells (Discord names its parts, like ChatInputActionButtonGift), so the list always
 * matches your Discord version. Hiding one makes it draw nothing. It works straight away for parts
 * already loaded and as soon as others load.
 */
import { createMMKVBackend, createStorage, wrapSync } from "@core/vendetta/storage";
import { instead } from "@lib/api/patcher";
import { onModuleLoaded } from "@metro/internals/modules";

export const hiddenThings = wrapSync(createStorage<{
    /** Names of the parts you hid. */
    hidden?: string[];
}>(createMMKVBackend("DELTACORD_HIDDEN_THINGS")));

/** Parts worth offering: their names say they're something you'd see and might not want. */
const INTERESTING = /(Upsell|Premium|Nitro|Gift|Shop|Quest|Boost|Promo|Marketing|Collectible|Coachmark|Nag|Banner|Tooltip|Badge|Button|Sticker|Gif|Emoji(?:Picker)?Button|Activity|Soundboard|SuperReaction|Clips?|AppLauncher|Apps)/;
// Building blocks used everywhere (hiding one would empty half of Discord), and non-visual parts.
const NOT_WORTH = /^(Base|Pressable|Touchable|Generic)|Context|Provider|Store|Manager|Utils?$|^(Button|Buttons|ButtonGroup|IconButton|TextButton|ImageButton|RowButton|Badge|Banner|Tooltip|Activity|Sticker|Gif|Clip|Apps?|Shop)$/;

interface Part { container: any; key: string; }

/** Every interesting part Discord has loaded this session, by name. */
const parts = new Map<string, Part[]>();
const undo = new Map<string, Array<() => unknown>>();
export const hideStatus = { started: false, seen: 0 };

const nameOf = (c: any): string | undefined => {
    const name = c?.displayName ?? c?.name;
    return typeof name === "string" && /^[A-Z][A-Za-z0-9_]{2,60}$/.test(name) ? name : undefined;
};

const isHidden = (name: string) => (hiddenThings.hidden ?? []).includes(name);

function hide(name: string, part: Part) {
    try {
        const u = instead(part.key, part.container, () => null);
        undo.set(name, [...(undo.get(name) ?? []), u]);
    } catch { }
}

function remember(name: string, container: any, key: string) {
    if (!INTERESTING.test(name) || NOT_WORTH.test(name)) return;
    const list = parts.get(name) ?? [];
    if (list.some(p => p.container === container && p.key === key)) return;
    const part = { container, key };
    parts.set(name, [...list, part]);
    hideStatus.seen = parts.size;
    if (isHidden(name)) hide(name, part);
}

/** Looks at a module's exports for named parts (plain, memo(...) or forwardRef(...)). */
function scan(exports: any) {
    if (!exports || (typeof exports !== "object" && typeof exports !== "function")) return;
    const keys = typeof exports === "object" ? Object.keys(exports).slice(0, 24) : [];
    for (const key of ["default", ...keys.filter(k => k !== "default")]) {
        let value: any;
        try {
            value = exports[key];
        } catch {
            continue;
        }
        if (typeof value === "function") {
            const name = nameOf(value);
            if (name) remember(name, exports, key);
        } else if (value && typeof value === "object") {
            for (const inner of ["type", "render"]) {
                const fn = value[inner];
                const name = typeof fn === "function" ? nameOf(fn) ?? nameOf(value) : undefined;
                if (name) remember(name, value, inner);
            }
        }
    }
}

/** Starts noticing (and hiding) parts. */
export function startHideThings() {
    if (hideStatus.started) return;
    hideStatus.started = true;
    onModuleLoaded(exports => {
        try {
            scan(exports);
        } catch { }
    });
}

export function setHidden(name: string, hidden: boolean) {
    const list = new Set(hiddenThings.hidden ?? []);
    if (hidden) list.add(name);
    else list.delete(name);
    hiddenThings.hidden = [...list];
    if (hidden) {
        if (!undo.has(name)) for (const part of parts.get(name) ?? []) hide(name, part);
    } else {
        for (const u of undo.get(name) ?? []) {
            try {
                u();
            } catch { }
        }
        undo.delete(name);
    }
}

export type ThingGroup = "Nitro, Shop and Quests" | "Chat bar" | "Banners and tips" | "Buttons" | "Other";

function groupOf(name: string): ThingGroup {
    if (/Upsell|Premium|Nitro|Gift|Shop|Quest|Boost|Promo|Marketing|Collectible|SuperReaction/.test(name)) return "Nitro, Shop and Quests";
    if (/ChatInput|ChatBar|Composer/.test(name)) return "Chat bar";
    if (/Banner|Coachmark|Nag|Tooltip|Tip/.test(name)) return "Banners and tips";
    if (/Button/.test(name)) return "Buttons";
    return "Other";
}

/** "ChatInputActionButtonGift" -> "Chat Input Action Button Gift". */
export const readableName = (name: string) => name.replace(/_/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");

/** What to show: everything noticed this session, plus anything you hid that hasn't loaded yet. */
export function listThings(): { name: string; group: ThingGroup; loaded: boolean; }[] {
    const names = new Set([...parts.keys(), ...(hiddenThings.hidden ?? [])]);
    return [...names].sort().map(name => ({ name, group: groupOf(name), loaded: parts.has(name) }));
}
