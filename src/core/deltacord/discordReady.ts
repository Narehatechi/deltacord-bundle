/**
 * Notices when Discord's real screen is up, so the startup animation (drawn by the patched app)
 * can stay over Discord's own loading screen until then.
 *
 * Logged in: when the connection to Discord opens. Logged out: once Discord has loaded the saved
 * login and says there isn't one (the login screen needs no connection).
 */
import { FluxDispatcher } from "@metro/common";
import { findByStoreNameLazy } from "@metro/wrappers";

import { onDiscordUp } from "@lib/addons/themes";

import { markUiReady, stage } from "./breadcrumbs";

const AuthenticationStore = findByStoreNameLazy("AuthenticationStore");
const READY_ACTIONS = ["CONNECTION_OPEN", "CONNECTION_OPEN_SUPPLEMENTAL", "POST_CONNECTION_OPEN"];

export function watchForDiscordReady() {
    const handlers: [string, () => void][] = [];
    const done = (how: string) => {
        markUiReady(how);
        // Switching Discord to the theme goes through its appearance settings, which belong to an
        // account: logged out, that kept Discord on its loading logo (Samsung reports). So the
        // theme switch waits for the login.
        if (how === "logged out") watchForLogin();
        else onDiscordUp();
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

    // Offline or slow: theme switches still happen once Discord has surely started (logged in).
    setTimeout(() => {
        try {
            if (AuthenticationStore.isAuthenticated?.() === false && !AuthenticationStore.getToken?.()) return;
        } catch { }
        onDiscordUp();
    }, 15_000);

    // Logged out: Discord goes to the login screen without connecting. Discord loads the saved
    // login in the background, so only decide once it's had time to, and only if Discord itself
    // says it isn't logged in.
    setTimeout(() => {
        try {
            const authenticated = AuthenticationStore.isAuthenticated?.();
            const token = AuthenticationStore.getToken?.();
            if (authenticated === false && !token) done("logged out");
            else stage(`still connecting (logged in: ${String(authenticated)})`, { quiet: true });
        } catch (e) {
            stage(`couldn't check login: ${String((e as Error)?.message ?? e)}`, { quiet: true });
        }
    }, 6000);
}

/** After logging in (from the login screen): now the theme can switch over. */
function watchForLogin() {
    const handler = () => {
        try {
            FluxDispatcher.unsubscribe("CONNECTION_OPEN", handler);
        } catch { }
        stage("logged in", { quiet: true });
        onDiscordUp();
    };
    try {
        FluxDispatcher.subscribe("CONNECTION_OPEN", handler);
    } catch { }
}
