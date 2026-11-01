/** Translation engine: free, key-less, with a fallback. No Discord imports, so it can be tested. */

export const LANGUAGES: Record<string, string> = {
    english: "en", spanish: "es", french: "fr", german: "de", italian: "it", portuguese: "pt", russian: "ru",
    japanese: "ja", korean: "ko", chinese: "zh-CN", arabic: "ar", hindi: "hi", turkish: "tr", polish: "pl",
    dutch: "nl", swedish: "sv", ukrainian: "uk", vietnamese: "vi", indonesian: "id", thai: "th", greek: "el",
    hebrew: "iw", finnish: "fi", norwegian: "no", danish: "da", czech: "cs", romanian: "ro", hungarian: "hu",
    tagalog: "tl", latin: "la",
};

/** "spanish", "Spanish", "es" → "es". */
export function languageCode(input: string | undefined, fallback = "en"): string {
    const value = String(input ?? "").trim().toLowerCase();
    if (!value) return fallback;
    if (LANGUAGES[value]) return LANGUAGES[value];
    // "jap" → Japanese; a two-letter or region code ("ja", "pt-br") is used as it is.
    const prefix = value.length >= 3 ? Object.keys(LANGUAGES).find(name => name.startsWith(value)) : undefined;
    if (prefix) return LANGUAGES[prefix];
    if (/^[a-z]{2,3}(-[a-z]{2})?$/i.test(value)) return value.replace(/-([a-z]{2})$/i, (_, r) => `-${r.toUpperCase()}`);
    return fallback;
}

export const nameOf = (code: string) => Object.keys(LANGUAGES).find(k => LANGUAGES[k] === code) ?? code;

export interface Segment { text: string; keep: boolean; }

/** Things that must never be translated: code, links, mentions, custom emoji, timestamps. */
const KEEP = /```[\s\S]*?```|`[^`\n]*`|https?:\/\/[^\s<>]+|<(?:@[!&]?\d+|#\d+|a?:\w+:\d+|t:\d+(?::\w)?)>|@(?:everyone|here)/g;

export function splitSegments(text: string): Segment[] {
    const out: Segment[] = [];
    let last = 0;
    for (const match of text.matchAll(KEEP)) {
        if (match.index! > last) out.push({ text: text.slice(last, match.index), keep: false });
        out.push({ text: match[0], keep: true });
        last = match.index! + match[0].length;
    }
    if (last < text.length) out.push({ text: text.slice(last), keep: false });
    return out;
}

/** Cuts long text at paragraph, line, then sentence breaks so no request gets too long. */
export function chunkText(text: string, max = 1200): string[] {
    if (text.length <= max) return [text];
    const chunks: string[] = [];
    let rest = text;
    while (rest.length > max) {
        const window = rest.slice(0, max);
        let cut = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf("\n"));
        if (cut < max / 2) cut = Math.max(...[". ", "! ", "? ", "。"].map(s => window.lastIndexOf(s) + s.length - 1));
        if (cut < max / 2) cut = window.lastIndexOf(" ");
        if (cut < max / 2) cut = max - 1;
        chunks.push(rest.slice(0, cut + 1));
        rest = rest.slice(cut + 1);
    }
    if (rest) chunks.push(rest);
    return chunks;
}

type Fetch = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<any>; }>;

async function google(f: Fetch, text: string, to: string, from: string) {
    const res = await f(`https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl=${encodeURIComponent(from)}&tl=${encodeURIComponent(to)}&q=${encodeURIComponent(text)}`);
    if (!res.ok) throw new Error(`Google failed (${res.status})`);
    const data = await res.json();
    const out = (data?.[0] ?? []).map((part: any) => part?.[0] ?? "").join("");
    if (!out && text.trim()) throw new Error("Google sent back nothing");
    return { text: out as string, from: (data?.[2] ?? from) as string };
}

async function lingva(f: Fetch, text: string, to: string, from: string) {
    const res = await f(`https://lingva.ml/api/v1/${encodeURIComponent(from)}/${encodeURIComponent(to)}/${encodeURIComponent(text)}`);
    if (!res.ok) throw new Error(`Lingva failed (${res.status})`);
    const data = await res.json();
    if (typeof data?.translation !== "string") throw new Error("Lingva sent back nothing");
    return { text: data.translation as string, from: (data?.info?.detectedSource ?? from) as string };
}

/** Tries Google, then Lingva (another free service), for one piece of text. */
async function piece(f: Fetch, text: string, to: string, from: string) {
    try {
        return await google(f, text, to, from);
    } catch (first) {
        try {
            return await lingva(f, text, to, from);
        } catch {
            throw first;
        }
    }
}

export async function translate(text: string, to: string, from = "auto", f: Fetch = fetch as any): Promise<{ text: string; from: string; }> {
    let detected = from;
    let out = "";
    for (const seg of splitSegments(text)) {
        if (seg.keep || !seg.text.trim()) {
            out += seg.text;
            continue;
        }
        // Keep the spacing around each piece, since translators trim it.
        const [, lead, body, trail] = seg.text.match(/^(\s*)([\s\S]*?)(\s*)$/)!;
        let translated = "";
        for (const chunk of chunkText(body)) {
            const r = await piece(f, chunk, to, detected);
            // Reuse the language found on the first piece so later pieces stay consistent.
            if (detected === "auto" && r.from) detected = r.from;
            translated += r.text;
        }
        out += lead + translated + trail;
    }
    return { text: out, from: detected };
}
