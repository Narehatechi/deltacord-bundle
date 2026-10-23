/**
 * Notices when Discord's real screen is up, so the startup animation (drawn by the patched app)
 * can stay over Discord's own loading screen until then.
 *
 * Logged in: when the connection to Discord opens. Logged out: shortly after Discord opens, since
 * the login screen needs no connection.
 */
import { FluxDispatcher } from "@metro/common";
import { findByStoreNameLazy } from "@metro/wrappers";

import { markUiReady, stage } from "./breadcrumbs";

const AuthenticationStore = findByStoreNameLazy("AuthenticationStore");
const READY_ACTIONS = ["CONNECTION_OPEN", "CONNECTION_OPEN_SUPPLEMENTAL", "POST_CONNECTION_OPEN"];

export function watchForDiscordReady() {
    const handlers: [string, () => void][] = [];
    const done = (how: string) => {
        markUiReady(how);
        for (const [type, handler] of handlers) {
            try {
                FluxDispatcher.unsubscribe(type, handler);
            } catch { }
        }
        handlers.length = 0;
    };

    for (const type of READY_ACTIONS) {
        const handler = () => done(type);
        try {
            FluxDispatcher.subscribe(type, handler);
            handlers.push([type, handler]);
        } catch (e) {
            stage(`couldn't watch ${type}: ${String((e as Error)?.message ?? e)}`, { quiet: true });
        }
    }

    // Logged out: Discord goes straight to the login screen.
    setTimeout(() => {
        try {
            if (!AuthenticationStore.getToken?.()) done("logged out");
        } catch { }
    }, 1500);
}
