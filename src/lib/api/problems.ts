/**
 * Problems Deltacord caught before they could crash Discord: a hook that threw, a screen that
 * broke and was retried. Doctor lists them, with where each came from, so the real cause can
 * still be found and fixed. The last few are also saved, so a problem that ended with a crash
 * screen can still be seen after Discord is restarted.
 */

export interface Problem {
    /** What failed, e.g. "after render (Discord's SoundboardButton)". */
    where: string;
    message: string;
    /** The plugin or part of Deltacord it came from, when that can be told. */
    source: string;
    count: number;
    first: number;
    last: number;
    /** It kept failing, so it stopped itself until Discord restarts. */
    stopped?: boolean;
    /** The first lines of where it happened. */
    stack?: string;
    /** Which launch of Discord it happened in. */
    session?: number;
}

/** This launch of Discord. */
export const SESSION = Date.now();
const SAVED_FILE = "problems-log.json";
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function stackOf(error: unknown): string | undefined {
    try {
        const stack = (error as any)?.stack ?? (error as any)?.componentStack;
        if (typeof stack !== "string") return undefined;
        return stack.split("\n").map(l => l.trim()).filter(Boolean).slice(0, 8).join("\n").slice(0, 900);
    } catch {
        return undefined;
    }
}

/** Saves the newest problems (with earlier launches' ones) so they outlive a crash. */
function scheduleSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(async () => {
        saveTimer = undefined;
        try {
            const fs = require("@lib/api/native/fs");
            const earlier = (await savedProblems()).filter(p => p.session !== SESSION);
            const all = [...problemList(), ...earlier].slice(0, 20);
            await fs.writeFile(SAVED_FILE, JSON.stringify(all));
        } catch { }
    }, 800);
}

/** Problems saved by this and earlier launches, newest first. */
export async function savedProblems(): Promise<Problem[]> {
    try {
        const fs = require("@lib/api/native/fs");
        if (!(await fs.fileExists(SAVED_FILE))) return [];
        const list = JSON.parse(await fs.readFile(SAVED_FILE));
        return Array.isArray(list) ? list : [];
    } catch {
        return [];
    }
}

const MAX = 50;
export const problems = new Map<string, Problem>();

export function errorMessage(error: unknown): string {
    try {
        if (error instanceof Error) return error.message || error.name;
        return String(error);
    } catch {
        return "unknown error";
    }
}

/** Works out which plugin (or Deltacord itself) a problem came from. */
export function sourceOf(...errors: unknown[]): string {
    for (const error of errors) {
        try {
            const suspect = require("@core/deltacord/crashguard").findSuspect(error);
            if (suspect) return `${suspect.name} (plugin)`;
        } catch { }
    }
    return "Deltacord";
}

export function recordProblem(where: string, error: unknown, source: string, stopped = false): Problem {
    const message = errorMessage(error);
    const key = `${where}\u0000${message}`;
    const now = Date.now();
    let problem = problems.get(key);
    if (problem) {
        problem.count++;
        problem.last = now;
        problem.stopped ||= stopped;
    } else {
        problem = { where, message, source, count: 1, first: now, last: now, stopped, stack: stackOf(error), session: SESSION };
        if (problems.size >= MAX) problems.delete(problems.keys().next().value!);
        problems.set(key, problem);
    }
    scheduleSave();
    if (problem.count === 1 || stopped) console.error(`[Deltacord] Caught a problem in ${where} (${source})${stopped ? "; it's off until restart" : ""}`, error);
    return problem;
}

export const problemList = () => [...problems.values()].sort((a, b) => b.last - a.last);

/** Where Deltacord's own code and its plugins run, as it appears in error stacks. */
const OURS = /cache\/deltacord\/bundle\.js|deltacord\.bundle|bunny-plugin\/|vendetta-plugin|plugins\/[a-z0-9-]+\/index\.js/i;

/**
 * Whether an error started in Deltacord's own code or a plugin (its first stack frame is ours),
 * rather than in Discord's. Only those are safe to stop: Discord's own errors go to Discord.
 */
export function startedInDeltacord(stack: unknown): boolean {
    if (typeof stack !== "string") return false;
    const frame = stack.split("\n").map(l => l.trim()).find(l => l.startsWith("at ") || /@|\(.+:\d+:\d+\)$/.test(l));
    return !!frame && OURS.test(frame);
}
