/**
 * Calls methods the patched app (the Deltacord module) adds, e.g. `deltacord.sound.play`.
 *
 * The module listens on two native methods Discord already has: FileReaderModule.readAsDataURL
 * (returns a promise; works for every method) and RNSVGRenderableManager.getBBox (instant; only
 * for methods that answer straight away). A call is marked by a `deltacord` object.
 */
function nativeModule(...names: string[]): any {
    for (const name of names) {
        try {
            const viaTurbo = (globalThis as any).__turboModuleProxy?.(name);
            if (viaTurbo) return viaTurbo;
        } catch { }
        const viaProxy = (window as any).nativeModuleProxy?.[name];
        if (viaProxy) return viaProxy;
    }
    return undefined;
}

const unwrap = (response: any) => {
    if (response && typeof response === "object" && "error" in response && response.error) throw new Error(String(response.error));
    return response?.result;
};

/** Calls a module method and waits for its answer. */
export async function callNative(method: string, ...args: any[]): Promise<any> {
    const reader = nativeModule("FileReaderModule");
    if (typeof reader?.readAsDataURL !== "function") throw new Error("Deltacord's native bridge isn't available");
    return unwrap(await reader.readAsDataURL({ deltacord: { method, args } }));
}

/** Calls a module method that answers straight away, without waiting on a promise. */
export function callNativeSync(method: string, ...args: any[]): any {
    const svg = nativeModule("RNSVGRenderableManager");
    if (typeof svg?.getBBox !== "function") throw new Error("Deltacord's instant native bridge isn't available");
    return unwrap(svg.getBBox(0, { deltacord: { method, args } }));
}
