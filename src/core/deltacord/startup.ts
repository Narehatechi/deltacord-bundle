/**
 * Startup watchdog.
 *
 * Discord isn't allowed to start until every step of Deltacord's startup has finished, so a
 * single step that never finishes leaves Discord stuck on its logo forever. Each step is given a
 * time limit; a step that runs over is left to finish in the background and Discord starts anyway.
 * Slow steps are remembered so the Doctor page can show which one it was.
 */

const DEFAULT_LIMIT_MS = 8000;

/** Steps that ran over their limit during this launch. */
export const slowSteps: string[] = [];
/** Steps that failed with an error during this launch. */
export const failedSteps: string[] = [];
/** How long each step took (ms), for the Doctor page. */
export const stepTimes: Record<string, number> = {};

export function guardStep<T>(name: string, work: Promise<T> | T, limitMs = DEFAULT_LIMIT_MS): Promise<T | undefined> {
    const started = Date.now();
    const finished = Promise.resolve(work).then(
        value => {
            stepTimes[name] = Date.now() - started;
            return value;
        },
        error => {
            stepTimes[name] = Date.now() - started;
            failedSteps.push(name);
            console.error(`[Deltacord] Startup step "${name}" failed`, error);
            return undefined;
        },
    );

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<undefined>(resolve => {
        timer = setTimeout(() => {
            slowSteps.push(name);
            console.warn(`[Deltacord] Startup step "${name}" is taking over ${limitMs / 1000}s; starting Discord anyway`);
            resolve(undefined);
        }, limitMs);
    });

    return Promise.race([finished, timeout]).finally(() => clearTimeout(timer));
}
