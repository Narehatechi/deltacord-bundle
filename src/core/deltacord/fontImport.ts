/**
 * Import any font file from the phone (.ttf or .otf) and use it for all of Discord's text.
 *
 * The file is kept in Deltacord's folder; the patched app copies it into place and puts it on
 * every piece of text Discord draws (the same way Deltacord's Determination works).
 */
import { fonts, selectFont } from "@lib/addons/fonts";
import { callNative } from "@lib/api/native/bridge";
import { NativeFileModule } from "@lib/api/native/modules";

/** The font keys Discord's text uses (the patched app puts the font on all text anyway). */
const KEYS = [
    "ggsans-Normal", "ggsans-Medium", "ggsans-Semibold", "ggsans-Bold", "ggsans-ExtraBold",
    "ggsans-NormalItalic", "ggsans-MediumItalic", "ggsans-SemiboldItalic", "ggsans-BoldItalic", "ggsans-ExtraBoldItalic",
    "ggmono-Normal", "ggmono-Bold",
    "ABCGintoNord-ExtraBold",
];

/** A font file starts with one of these (TrueType, OpenType, Apple TrueType, a font collection). */
function looksLikeFont(base64Head: string): boolean {
    const head = atob(base64Head.slice(0, 8));
    const bytes = [...head].map(c => c.charCodeAt(0));
    const tag = head.slice(0, 4);
    return (bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0) || tag === "OTTO" || tag === "true" || tag === "ttcf";
}

/** Lets you pick a font file and switches to it. Returns its name, or null if you backed out. */
export async function importFontFile(): Promise<string | null> {
    let picked: any;
    try {
        picked = await callNative("deltacord.files.pick", "*/*", "pyoncord/deltacord-fonts");
    } catch (e: any) {
        const message = String(e?.message ?? e);
        if (/not registered|isn't available/i.test(message)) throw new Error("Update the Deltacord module in Deltacord Manager to import files");
        throw new Error(message.split("\n")[0]);
    }
    if (!picked?.path) return null;
    const path = String(picked.path);
    const fileName = String(picked.name ?? path.split("/").pop() ?? "font");

    const head = await NativeFileModule.readFile(path, "base64");
    if (!looksLikeFont(String(head))) {
        try { await NativeFileModule.removeFile?.("documents", `pyoncord/deltacord-fonts/${path.split("/").pop()}`); } catch { }
        throw new Error("That isn't a font file. Pick a .ttf or .otf font.");
    }

    let name = fileName.replace(/\.(ttf|otf|ttc)$/i, "").replace(/[^\w -]+/g, "").trim().slice(0, 40) || "My font";
    if (name.startsWith("__")) name = name.replace(/^_+/, "");
    for (let i = 2, base = name; name in fonts; i++) name = `${base} ${i}`;

    fonts[name] = {
        spec: 1,
        name,
        description: `Imported from your phone (${fileName}).`,
        main: Object.fromEntries(KEYS.map(key => [key, `file://${path}`])),
    };
    await selectFont(name);
    return name;
}
