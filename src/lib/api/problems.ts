/**
 * Problems Deltacord caught before they could crash Discord: a hook that threw, a screen that
 * broke and was retried. Doctor lists them, with where each came from, so the real cause can
 * still be found and fixed. Kept for this session only.
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
        problem = { where, message, source, count: 1, first: now, last: now, stopped };
        if (problems.size >= MAX) problems.delete(problems.keys().next().value!);
        problems.set(key, problem);
    }
    if (problem.count === 1 || stopped) console.error(`[Deltacord] Caught a problem in ${where} (${source})${stopped ? "; it's off until restart" : ""}`, error);
    return problem;
}

export const problemList = () => [...problems.values()].sort((a, b) => b.last - a.last);
