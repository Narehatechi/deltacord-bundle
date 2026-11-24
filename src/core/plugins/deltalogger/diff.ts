/**
 * Small pure helpers for Deltalogger: what changed between two versions of a message, and
 * friendly times. Nothing here touches Discord, so it's covered by tests/deltalogger.test.ts.
 */

export interface Piece {
    text: string;
    kind: "same" | "removed" | "added";
}

/** Past this many words on either side, a word-by-word comparison isn't worth the time. */
const MAX_WORDS = 400;

/** Words with the spaces before them, so joining the pieces gives the text back. */
function words(text: string): string[] {
    return text.match(/\s*\S+|\s+$/g) ?? [];
}

/**
 * Word-by-word difference between two versions. Joining the "same" and "removed" pieces gives
 * [before]; joining the "same" and "added" pieces gives [after].
 */
export function wordDiff(before: string, after: string): Piece[] {
    const a = words(before), b = words(after);
    if (!a.length && !b.length) return [];
    if (a.length > MAX_WORDS || b.length > MAX_WORDS) {
        return [
            ...(before ? [{ text: before, kind: "removed" as const }] : []),
            ...(after ? [{ text: after, kind: "added" as const }] : []),
        ];
    }

    // Longest common run of words, compared without their trailing spaces.
    const key = (w: string) => w.trim();
    const rows = a.length + 1, cols = b.length + 1;
    const table = new Uint16Array(rows * cols);
    for (let i = a.length - 1; i >= 0; i--) {
        for (let j = b.length - 1; j >= 0; j--) {
            table[i * cols + j] = key(a[i]) === key(b[j])
                ? table[(i + 1) * cols + j + 1] + 1
                : Math.max(table[(i + 1) * cols + j], table[i * cols + j + 1]);
        }
    }

    const out: Piece[] = [];
    const push = (text: string, kind: Piece["kind"]) => {
        const last = out[out.length - 1];
        if (last?.kind === kind) last.text += text;
        else out.push({ text, kind });
    };
    let i = 0, j = 0;
    while (i < a.length && j < b.length) {
        if (key(a[i]) === key(b[j])) {
            push(a[i], "same");
            i++;
            j++;
        } else if (table[(i + 1) * cols + j] >= table[i * cols + j + 1]) push(a[i++], "removed");
        else push(b[j++], "added");
    }
    while (i < a.length) push(a[i++], "removed");
    while (j < b.length) push(b[j++], "added");
    return out;
}

/** One or two short lines saying what an edit took out and put in. */
export function describeChange(before: string, after: string): string {
    const pieces = wordDiff(before, after);
    const short = (kind: Piece["kind"]) => {
        const text = pieces.filter(p => p.kind === kind).map(p => p.text.trim()).filter(Boolean).join(" … ");
        return text.length > 200 ? `${text.slice(0, 200)}…` : text;
    };
    const removed = short("removed"), added = short("added");
    return [removed && `− ${removed}`, added && `+ ${added}`].filter(Boolean).join("\n");
}

/** "12s", "4m", "2h", "3d": how long something lasted. */
export function lifetime(ms: number): string {
    if (!(ms >= 0)) return "";
    const s = Math.round(ms / 1000);
    if (s < 60) return `${Math.max(1, s)}s`;
    if (s < 3600) return `${Math.round(s / 60)}m`;
    if (s < 86_400) return `${Math.round(s / 3600)}h`;
    return `${Math.round(s / 86_400)}d`;
}

/** "just now", "5m ago", "3h ago", "2d ago", then the date. */
export function ago(ms: number, now = Date.now()): string {
    if (!ms) return "";
    const gone = now - ms;
    if (gone < 45_000) return "just now";
    if (gone < 7 * 86_400_000) return `${lifetime(gone)} ago`;
    const d = new Date(ms);
    return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

/** The day a time falls on, for grouping: "Today", "Yesterday", or the date. */
export function dayOf(ms: number, now = Date.now()): string {
    const start = (t: number) => {
        const d = new Date(t);
        return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    };
    const days = Math.round((start(now) - start(ms)) / 86_400_000);
    if (days === 0) return "Today";
    if (days === 1) return "Yesterday";
    const d = new Date(ms);
    return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

/** The names that come up most, most first. */
export function topOf(names: string[], limit = 5): Array<[string, number]> {
    const tally = new Map<string, number>();
    for (const name of names) tally.set(name, (tally.get(name) ?? 0) + 1);
    return [...tally.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).slice(0, limit);
}
