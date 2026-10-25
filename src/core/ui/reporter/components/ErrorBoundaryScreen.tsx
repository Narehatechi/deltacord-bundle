/**
 * The crash screen, Deltarune style: the red SOUL beats, cracks and shatters, "GAME OVER" fades
 * in, then a dialogue box types out what happened and a menu (with the SOUL as the cursor) offers
 * the ways back: try again, reload, turn off the plugin that crashed, Safe Mode, details, copy.
 */
import { disableSuspect, findSuspect } from "@core/deltacord/crashguard";
import { hasStack, isComponentStack } from "@core/ui/reporter/utils/isStack";
import { getDebugInfo, toggleSafeMode } from "@lib/api/debug";
import { BundleUpdaterManager } from "@lib/api/native/modules";
import { settings } from "@lib/api/settings";
import { ErrorBoundary } from "@lib/ui/components";
import { clipboard } from "@metro/common";
import { SafeAreaProvider, SafeAreaView } from "@metro/common/components";
import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Pressable, ScrollView, Text, View } from "react-native";

const RED = "#FF0000";
const YELLOW = "#FFFF00";
const WHITE = "#FFFFFF";
// Discord's own font names: Deltacord's themes swap these for Determination.
const FONT = "ggsans-Normal";
const FONT_BOLD = "ggsans-Bold";
const MONO = "ggmono-Normal";

const SHARDS = [
    { x: -70, y: -60, r: -220 }, { x: -30, y: -95, r: 160 }, { x: 25, y: -85, r: -140 },
    { x: 75, y: -50, r: 240 }, { x: -55, y: 10, r: 120 }, { x: 60, y: 20, r: -200 },
];

/** The SOUL: beats, cracks in two, then bursts into shards that fall away. */
function Soul({ onShattered }: { onShattered: () => void; }) {
    const beat = useRef(new Animated.Value(1)).current;
    const crack = useRef(new Animated.Value(0)).current;
    const shake = useRef(new Animated.Value(0)).current;
    const burst = useRef(new Animated.Value(0)).current;
    const [stage, setStage] = useState<"whole" | "cracked" | "shards">("whole");

    useEffect(() => {
        const sequence = Animated.sequence([
            Animated.timing(beat, { toValue: 1.25, duration: 140, useNativeDriver: true }),
            Animated.timing(beat, { toValue: 1, duration: 220, useNativeDriver: true }),
            Animated.delay(350),
        ]);
        sequence.start(() => {
            setStage("cracked");
            Animated.sequence([
                Animated.timing(crack, { toValue: 1, duration: 120, useNativeDriver: true }),
                Animated.loop(Animated.sequence([
                    Animated.timing(shake, { toValue: 1, duration: 40, useNativeDriver: true }),
                    Animated.timing(shake, { toValue: -1, duration: 40, useNativeDriver: true }),
                ]), { iterations: 6 }),
                Animated.timing(shake, { toValue: 0, duration: 40, useNativeDriver: true }),
                Animated.delay(250),
            ]).start(() => {
                setStage("shards");
                Animated.timing(burst, { toValue: 1, duration: 1100, easing: Easing.out(Easing.quad), useNativeDriver: true })
                    .start(() => onShattered());
            });
        });
    }, []);

    const heart = (style: any) => <Text style={[{ color: RED, fontSize: 64, lineHeight: 72, fontFamily: FONT_BOLD }, style]}>♥</Text>;
    const shakeX = shake.interpolate({ inputRange: [-1, 1], outputRange: [-3, 3] });

    return (
        <View style={{ height: 120, alignItems: "center", justifyContent: "center" }}>
            {stage === "whole" && <Animated.View style={{ transform: [{ scale: beat }] }}>{heart(null)}</Animated.View>}
            {stage === "cracked" && (
                <Animated.View style={{ flexDirection: "row", transform: [{ translateX: shakeX }] }}>
                    {/* The two halves of the heart, pulled apart by the crack. */}
                    <Animated.View style={{
                        width: 32, overflow: "hidden",
                        transform: [
                            { translateX: crack.interpolate({ inputRange: [0, 1], outputRange: [0, -5] }) },
                            { rotate: crack.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "-8deg"] }) },
                        ],
                    }}>
                        {heart({ width: 64, textAlign: "center" })}
                    </Animated.View>
                    <Animated.View style={{
                        width: 32, overflow: "hidden",
                        transform: [
                            { translateX: crack.interpolate({ inputRange: [0, 1], outputRange: [0, 5] }) },
                            { rotate: crack.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "8deg"] }) },
                        ],
                    }}>
                        {heart({ width: 64, textAlign: "center", marginLeft: -32 })}
                    </Animated.View>
                </Animated.View>
            )}
            {stage === "shards" && SHARDS.map((s, i) => (
                <Animated.View
                    key={i}
                    style={{
                        position: "absolute",
                        width: 10,
                        height: 10,
                        backgroundColor: RED,
                        opacity: burst.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 1, 0] }),
                        transform: [
                            { translateX: burst.interpolate({ inputRange: [0, 1], outputRange: [0, s.x] }) },
                            // Up and out first, then falling.
                            { translateY: burst.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0, s.y, s.y + 170] }) },
                            { rotate: burst.interpolate({ inputRange: [0, 1], outputRange: ["0deg", `${s.r}deg`] }) },
                        ],
                    }}
                />
            ))}
        </View>
    );
}

/** Types text out a letter at a time, like the game's dialogue. Tap to finish it at once. */
function Typewriter({ lines, onDone }: { lines: string[]; onDone?: () => void; }) {
    const full = lines.join("\n");
    const [shown, setShown] = useState(0);
    useEffect(() => {
        if (shown >= full.length) {
            onDone?.();
            return;
        }
        // A short pause after punctuation, like the game.
        const prev = full[shown - 1];
        const delay = prev && ".!?".includes(prev) ? 180 : prev === "," ? 90 : 28;
        const timer = setTimeout(() => setShown(n => n + 1), delay);
        return () => clearTimeout(timer);
    }, [shown, full]);

    return (
        <Pressable onPress={() => setShown(full.length)}>
            <Text style={{ color: WHITE, fontSize: 17, lineHeight: 26, fontFamily: FONT }}>{full.slice(0, shown)}</Text>
        </Pressable>
    );
}

/** A Deltarune text box: black, with a thick white double border. */
function Box({ children, style }: { children: any; style?: any; }) {
    return (
        <View style={[{ borderWidth: 3, borderColor: WHITE, padding: 3, backgroundColor: "#000" }, style]}>
            <View style={{ borderWidth: 1, borderColor: WHITE, padding: 14 }}>{children}</View>
        </View>
    );
}

interface Choice { label: string; act: () => void; }

function Menu({ choices }: { choices: Choice[]; }) {
    const [selected, setSelected] = useState(0);
    return (
        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", rowGap: 10, columnGap: 18 }}>
            {choices.map((choice, i) => (
                <Pressable
                    key={choice.label}
                    onPressIn={() => setSelected(i)}
                    onPress={choice.act}
                    style={{ flexDirection: "row", alignItems: "center", paddingVertical: 6, paddingHorizontal: 4 }}
                >
                    <Text style={{ color: RED, fontSize: 18, width: 22, fontFamily: FONT_BOLD, opacity: selected === i ? 1 : 0 }}>♥</Text>
                    <Text style={{ color: selected === i ? YELLOW : WHITE, fontSize: 18, letterSpacing: 1, fontFamily: FONT_BOLD }}>
                        {choice.label.toUpperCase()}
                    </Text>
                </Pressable>
            ))}
        </View>
    );
}

function errorText(error: any) {
    const parts = [String(error?.message ?? error)];
    if (hasStack(error)) parts.push("", String(error.stack));
    if (isComponentStack(error)) parts.push("", "Component stack:", String(error.componentStack).trim());
    return parts.join("\n");
}

export default function ErrorBoundaryScreen(props: {
    error: Error;
    rerender: () => void;
}) {
    const debugInfo = getDebugInfo();
    const suspect = useMemo(() => findSuspect(props.error), [props.error]);
    const [shattered, setShattered] = useState(false);
    const [talked, setTalked] = useState(false);
    const [details, setDetails] = useState(false);
    const [copied, setCopied] = useState(false);
    const title = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        if (shattered) Animated.timing(title, { toValue: 1, duration: 1400, useNativeDriver: true }).start();
    }, [shattered]);

    const report = () => [
        "Deltacord crash report",
        `${debugInfo.os.name} ${debugInfo.os.version ?? ""} · Discord ${debugInfo.discord.version} (${debugInfo.discord.build}) · Deltacord ${debugInfo.bunny.version}`,
        suspect ? `Plugin: ${suspect.name} (${suspect.id})` : "",
        "",
        errorText(props.error),
    ].join("\n");

    const lines = suspect
        ? [
            "* Discord tripped and fell.",
            `* It was "${suspect.name}" that did it.`,
            "* Turn it off, and you can keep going.",
        ]
        : [
            "* Discord tripped and fell.",
            "* Something on this screen broke while drawing.",
            "* But you're filled with DETERMINATION.",
        ];

    const choices: Choice[] = [
        { label: "Continue", act: () => props.rerender() },
        ...(suspect ? [{
            label: `Turn off ${suspect.name}`,
            act: () => {
                disableSuspect(suspect);
                setTimeout(() => BundleUpdaterManager.reload(), 400);
            },
        }] : []),
        { label: "Reload", act: () => BundleUpdaterManager.reload() },
        ...(!settings.safeMode?.enabled ? [{ label: "Safe Mode", act: () => void toggleSafeMode() }] : []),
        { label: details ? "Hide details" : "Details", act: () => setDetails(d => !d) },
        {
            label: copied ? "Copied!" : "Copy report",
            act: () => {
                try {
                    clipboard.setString(report());
                    setCopied(true);
                } catch { }
            },
        },
    ];

    return <ErrorBoundary>
        <SafeAreaProvider>
            <SafeAreaView style={{ flex: 1, backgroundColor: "#000" }}>
                <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 18, gap: 18 }}>
                    <Soul onShattered={() => setShattered(true)} />

                    <Animated.View style={{ opacity: title, alignItems: "center" }}>
                        <Text style={{ color: WHITE, fontSize: 52, letterSpacing: 6, fontFamily: FONT_BOLD, textAlign: "center" }}>GAME</Text>
                        <Text style={{ color: WHITE, fontSize: 52, letterSpacing: 6, fontFamily: FONT_BOLD, textAlign: "center" }}>OVER</Text>
                    </Animated.View>

                    {shattered && (
                        <Box>
                            <Typewriter lines={lines} onDone={() => setTalked(true)} />
                        </Box>
                    )}

                    {talked && <Menu choices={choices} />}

                    {details && (
                        <Box style={{ maxHeight: 320 }}>
                            <ScrollView nestedScrollEnabled>
                                <Text selectable style={{ color: "#BBBBBB", fontSize: 12, lineHeight: 17, fontFamily: MONO }}>{errorText(props.error)}</Text>
                            </ScrollView>
                        </Box>
                    )}

                    {talked && (
                        <Text style={{ color: "#666", fontSize: 11, textAlign: "center", fontFamily: FONT }}>
                            {debugInfo.discord.version} ({debugInfo.discord.build}) · Deltacord {debugInfo.bunny.version}
                        </Text>
                    )}
                </ScrollView>
            </SafeAreaView>
        </SafeAreaProvider>
    </ErrorBoundary>;
}
