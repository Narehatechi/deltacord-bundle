/**
 * Lets startup steps ask "is this launch in Safe Mode?" after the crash guard has had its say
 * (it can switch Safe Mode on for this launch if the last ones didn't make it).
 */
import { awaitStorage } from "@core/vendetta/storage";
import { settings } from "@lib/api/settings";

let decide: () => void = () => { };
const decided = new Promise<void>(resolve => (decide = resolve));

/** Called by the crash guard once it has decided (always, even if it failed). */
export const markGuardDecided = () => decide();

/** True if this launch runs in Safe Mode. Never waits more than a few seconds. */
export async function startingInSafeMode(): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const limit = new Promise<void>(resolve => (timer = setTimeout(resolve, 3000)));
    try {
        await Promise.race([Promise.all([decided, awaitStorage(settings)]), limit]);
    } catch { } finally {
        clearTimeout(timer);
    }
    try {
        return settings.safeMode?.enabled === true;
    } catch {
        return false;
    }
}
