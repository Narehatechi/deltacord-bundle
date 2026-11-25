import ErrorBoundaryScreen from "@core/ui/reporter/components/ErrorBoundaryScreen";
import { after } from "@lib/api/patcher";
import { _lazyContextSymbol } from "@metro/lazy";
import { LazyModuleContext } from "@metro/types";
import { findByNameLazy } from "@metro/wrappers";

function getErrorBoundaryContext() {
    const ctxt: LazyModuleContext = findByNameLazy("ErrorBoundary")[_lazyContextSymbol];
    return new Promise(resolve => ctxt.getExports(exp => resolve(exp.prototype)));
}

/** One quiet retry per screen at most this often; a screen that breaks again shows the crash screen. */
const RETRY_WINDOW_MS = 10_000;
const lastRetry = new WeakMap<object, number>();

export default function patchErrorBoundary() {
    return after.await("render", getErrorBoundaryContext(), function (this: any) {
        if (!this.state.error) return;

        // Many breaks are one-offs (something drawn a moment too early). Try the screen again once
        // before showing the crash screen; if it breaks again straight away, show it.
        const error = this.state.error;
        const now = Date.now();
        if (now - (lastRetry.get(this) ?? 0) > RETRY_WINDOW_MS) {
            lastRetry.set(this, now);
            try {
                const { recordProblem, sourceOf } = require("@lib/api/problems");
                recordProblem("a Discord screen (retried by itself)", error, sourceOf(error));
            } catch { }
            setTimeout(() => {
                try {
                    if (this.state.error === error) this.setState({ info: null, error: null });
                } catch { }
            }, 0);
            return null;
        }

        // It broke again: the crash screen shows. Noted, so it can still be seen after a restart.
        try {
            const { recordProblem, sourceOf } = require("@lib/api/problems");
            recordProblem("a Discord screen (crash screen shown)", error, sourceOf(error));
        } catch { }

        return <ErrorBoundaryScreen
            error={this.state.error}
            rerender={() => this.setState({ info: null, error: null })}
        />;
    });
}
