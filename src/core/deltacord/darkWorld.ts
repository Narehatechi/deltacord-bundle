/**
 * The animated dark world: with Deltacord's own themes, the module draws a moving dark world over
 * the whole app (a scrolling grid, drifting coloured lights, sparkles), blended so it only lights
 * up dark areas and text stays readable. This tells the module when to draw it, and in which
 * colours, through a small file it reads.
 */
import { settings } from "@lib/api/settings";
import { NativeFileModule } from "@lib/api/native/modules";

const FILE = "pyoncord/deltacord-world.json";

/** Each built-in theme's world. */
const WORLDS: Record<string, string> = {
    "deltacord://builtin/deltarune": "deltarune",
    "deltacord://builtin/lightworld": "lightworld",
    "deltacord://builtin/crimson": "crimson",
};

let last = "";

/** Tells the module whether (and how) to draw the world, for this theme (default: the current one). */
export async function syncDarkWorld(themeId?: string | null) {
    try {
        const { getExtras } = require("./extras");
        const extras = getExtras();
        const id = themeId === undefined ? require("@lib/addons/themes").getCurrentTheme()?.id : themeId;
        const world = id ? WORLDS[id] : undefined;
        const on = !!world && extras.animatedWorld !== false && !settings.safeMode?.enabled;
        const body = JSON.stringify({ on, world: world ?? "deltarune", strength: extras.worldStrength ?? "normal" });
        if (body === last) return;
        last = body;
        await NativeFileModule.writeFile("documents", FILE, body, "utf8");
    } catch (e) {
        console.warn("[Deltacord] Couldn't update the animated world", e);
    }
}
