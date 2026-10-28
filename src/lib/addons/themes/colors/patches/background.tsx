import { colorsPref } from "@lib/addons/themes/colors/preferences";
import { _colorRef } from "@lib/addons/themes/colors/updater";
import { after } from "@lib/api/patcher";
import { useObservable } from "@lib/api/storage";
import { findInReactTree } from "@lib/utils";
import { findByDisplayNameLazy } from "@metro";
import { getLazyContext } from "@metro/lazy";
import chroma from "chroma-js";
import { ImageBackground, StyleSheet } from "react-native";
import { logger } from "@lib/utils/logger";

const MessagesModule = findByDisplayNameLazy("MessagesConnected", false);

function ThemeBackground({ children }: { children: React.ReactNode; }) {
    useObservable([colorsPref]);

    if (!_colorRef.current
        || colorsPref.customBackground === "hidden"
        || !_colorRef.current.background?.url
        || _colorRef.current.background?.blur && (typeof _colorRef.current.background?.blur !== "number")
    ) {
        return children;
    }

    return <ImageBackground
        style={{ flex: 1, height: "100%" }}
        source={{ uri: _colorRef.current.background?.url }}
        blurRadius={_colorRef.current.background?.blur}
    >
        {children}
    </ImageBackground>;
}

function onRender(_: any, ret: any) {
    if (!_colorRef.current || !_colorRef.current.background?.url) return;

    const messagesComponent = findInReactTree(
        ret,
        x => x && "HACK_fixModalInteraction" in x.props && x?.props?.style
    );

    if (messagesComponent) {
        const flattened = StyleSheet.flatten(messagesComponent.props.style);
        const backgroundColor = chroma(
            flattened.backgroundColor || "black"
        ).alpha(
            1 - (_colorRef.current.background?.opacity ?? 1)
        ).hex();

        messagesComponent.props.style = StyleSheet.flatten([
            messagesComponent.props.style,
            { backgroundColor }
        ]);
    }

    return <ThemeBackground>{ret}</ThemeBackground>;
}

/** The object whose `render` draws the message list (Discord has shipped it a few ways). */
function renderHolder(messages: any) {
    if (typeof messages?.render === "function") return messages;
    if (typeof messages?.type?.render === "function") return messages.type;
    return null;
}

export default function patchChatBackground() {
    let unpatch: (() => void) | undefined;
    let stopped = false;
    const apply = (messages: any) => {
        if (stopped || unpatch) return;
        const holder = renderHolder(messages);
        if (!holder) {
            // Not a shape we can patch: the chat just won't show a theme's background picture.
            logger.warn("Chat background: Discord's message list can't be patched in this version");
            return;
        }
        try {
            unpatch = after("render", holder, onRender);
        } catch (e) {
            logger.error("Failed to patch chat background.", e);
        }
    };
    try {
        const context = getLazyContext(Messages);
        if (context) context.getExports(apply);
        else apply(Messages);
    } catch (e) {
        logger.error("Failed to patch chat background.", e);
    }
    return () => {
        stopped = true;
        unpatch?.();
    };
}
