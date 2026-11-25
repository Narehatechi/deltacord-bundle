/**
 * Safety nets around parts of Discord that can break on their own and take the whole app down
 * with them. If one breaks, it draws nothing for a moment and comes back; the rest of Discord
 * keeps working, and the problem is listed in Doctor.
 *
 * - Discord's pop-ups (toasts): a toast Discord couldn't place crashed the whole app.
 */
import { onJsxCreate } from "@lib/api/react/jsx";
import { Component, createElement, isValidElement } from "react";

const SURFACES = ["AppToastContainer", "ToastContainer"];

class Surface extends Component<{ name: string; children: any; }, { failed: boolean; }> {
    state = { failed: false };
    private timer?: ReturnType<typeof setTimeout>;
    static getDerivedStateFromError() {
        return { failed: true };
    }
    componentDidCatch(error: unknown) {
        try {
            const { recordProblem, sourceOf } = require("@lib/api/problems");
            recordProblem(`Discord's ${this.props.name} (kept from crashing Discord)`, error, sourceOf(error));
        } catch { }
        // Back in a moment, once whatever broke it has gone.
        this.timer = setTimeout(() => this.setState({ failed: false }), 3000);
    }
    componentWillUnmount() {
        if (this.timer) clearTimeout(this.timer);
    }
    render() {
        return this.state.failed ? null : this.props.children;
    }
}

let started = false;
export function startSafeSurfaces() {
    if (started) return;
    started = true;
    for (const name of SURFACES) {
        onJsxCreate(name, (_component: any, ret: any) => {
            try {
                if (!isValidElement(ret) || (ret as any).props?.__deltacordSafe) return ret;
                return createElement(Surface, { name, key: (ret as any).key ?? undefined, __deltacordSafe: true } as any, ret);
            } catch {
                return ret;
            }
        });
    }
}
