/**
 * The crash screen, Deltarune style.
 *
 * Dark-world dust drifts up the screen. The pixel SOUL beats twice, cracks, and shatters with a
 * white flash and a screen shake. GAME OVER drops in letter by letter. A text box types out what
 * happened, with blips. Then battle-style buttons (the SOUL is the cursor) offer the ways back,
 * and CONTINUE puts the SOUL back together before trying again.
 * Tap anywhere during the intro to skip it.
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
const ORANGE = "#FF7F27";
const WHITE = "#FFFFFF";
const PURPLE = "#8A4DFF";
// Discord's own font names: Deltacord's themes swap these for Determination.
const FONT = "ggsans-Normal";
const FONT_BOLD = "ggsans-Bold";
const MONO = "ggmono-Normal";

/** Blips while text types, like the game (quietly does nothing if sound isn't available). */
function blip() {
    try {
        require("@core/deltacord/extras").previewSound("blip");
    } catch { }
}

// ------------------------------------------------------------------ the SOUL

const HEART = [
    ".XXX...XXX.",
    "XXXXX.XXXXX",
    "XXXXXXXXXXX",
    "XXXXXXXXXXX",
    ".XXXXXXXXX.",
    "..XXXXXXX..",
    "...XXXXX...",
    "....XXX....",
    ".....X.....",
];
/** Where the crack runs on each row: squares left of this column are the left half. */
const CRACK = [5, 6, 5, 4, 5, 6, 5, 4, 5];
const PIXEL = 7;

function PixelHeart({ pixel, part = "whole", color = RED }: { pixel: number; part?: "whole" | "left" | "right"; color?: string; }) {
    const squares: any[] = [];
    HEART.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) {
            if (row[x] !== "X") continue;
            const left = x < CRACK[y];
            if ((part === "left" && !left) || (part === "right" && left)) continue;
            squares.push(<View key={`${x},${y}`} style={{ position: "absolute", left: x * pixel, top: y * pixel, width: pixel, height: pixel, backgroundColor: color }} />);
        }
    });
    return <View style={{ width: HEART[0].length * pixel, height: HEART.length * pixel }}>{squares}</View>;
}

const SHARDS = Array.from({ length: 10 }, (_, i) => {
    const angle = (i / 10) * Math.PI * 2 + 0.3;
    const reach = 50 + (i % 3) * 22;
    return { x: Math.cos(angle) * reach, y: Math.sin(angle) * reach - 40, r: (i % 2 ? 1 : -1) * (120 + i * 25), size: i % 3 === 0 ? 3 : 2 };
});

type SoulStage = "whole" | "cracked" | "shards" | "mending";

/**
 * break: beat, beat, crack, shake, shatter (calls onFlash at the shatter, onDone after).
 * Then `mend()` (via the mending prop) pulls the shards back into a whole SOUL.
 */
function Soul({ skip, mending, onFlash, onDone, onMended }: {
    skip: boolean;
    mending: boolean;
    onFlash: () => void;
    onDone: () => void;
    onMended: () => void;
}) {
    const beat = useRef(new Animated.Value(1)).current;
    const crack = useRef(new Animated.Value(0)).current;
    const shake = useRef(new Animated.Value(0)).current;
    const burst = useRef(new Animated.Value(0)).current;
    const [stage, setStage] = useState<SoulStage>("whole");
    const running = useRef<Animated.CompositeAnimation | null>(null);

    const shatter = () => {
        setStage("shards");
        onFlash();
        running.current = Animated.timing(burst, { toValue: 1, duration: 1000, easing: Easing.out(Easing.quad), useNativeDriver: true });
        running.current.start(() => onDone());
    };

    useEffect(() => {
        if (skip) return;
        const thump = () => Animated.sequence([
            Animated.timing(beat, { toValue: 1.22, duration: 110, useNativeDriver: true }),
            Animated.timing(beat, { toValue: 1, duration: 200, useNativeDriver: true }),
        ]);
        running.current = Animated.sequence([Animated.delay(250), thump(), Animated.delay(120), thump(), Animated.delay(380)]);
        running.current.start(({ finished }) => {
            if (!finished) return;
            setStage("cracked");
            running.current = Animated.sequence([
                Animated.timing(crack, { toValue: 1, duration: 90, useNativeDriver: true }),
                Animated.loop(Animated.sequence([
                    Animated.timing(shake, { toValue: 1, duration: 35, useNativeDriver: true }),
                    Animated.timing(shake, { toValue: -1, duration: 35, useNativeDriver: true }),
                ]), { iterations: 8 }),
                Animated.timing(shake, { toValue: 0, duration: 35, useNativeDriver: true }),
                Animated.delay(200),
            ]);
            running.current.start(({ finished: done }) => done && shatter());
        });
        return () => running.current?.stop();
    }, []);

    // Skipped: jump straight to the end.
    useEffect(() => {
        if (!skip || stage === "shards" || stage === "mending") return;
        running.current?.stop();
        burst.setValue(1);
        setStage("shards");
        onDone();
    }, [skip]);

    // CONTINUE: the shards fly back together, the SOUL beats once, then we try again.
    useEffect(() => {
        if (!mending) return;
        setStage("mending");
        Animated.sequence([
            Animated.timing(burst, { toValue: 0, duration: 650, easing: Easing.in(Easing.quad), useNativeDriver: true }),
            Animated.timing(beat, { toValue: 1.3, duration: 120, useNativeDriver: true }),
            Animated.timing(beat, { toValue: 1, duration: 220, useNativeDriver: true }),
            Animated.delay(150),
        ]).start(() => onMended());
    }, [mending]);

    const shakeX = shake.interpolate({ inputRange: [-1, 1], outputRange: [-4, 4] });
    const showShards = stage === "shards" || stage === "mending";

    return (
        <View style={{ height: 130, alignItems: "center", justifyContent: "center" }}>
            {stage === "whole" && <Animated.View style={{ transform: [{ scale: beat }] }}><PixelHeart pixel={PIXEL} /></Animated.View>}
            {stage === "cracked" && (
                <Animated.View style={{ transform: [{ translateX: shakeX }] }}>
                    <Animated.View style={{
                        transform: [
                            { translateX: crack.interpolate({ inputRange: [0, 1], outputRange: [0, -PIXEL] }) },
                            { rotate: crack.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "-9deg"] }) },
                        ],
                    }}>
                        <PixelHeart pixel={PIXEL} part="left" />
                    </Animated.View>
                    <Animated.View style={{
                        position: "absolute",
                        transform: [
                            { translateX: crack.interpolate({ inputRange: [0, 1], outputRange: [0, PIXEL] }) },
                            { rotate: crack.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "9deg"] }) },
                        ],
                    }}>
                        <PixelHeart pixel={PIXEL} part="right" />
                    </Animated.View>
                </Animated.View>
            )}
            {showShards && SHARDS.map((s, i) => (
                <Animated.View
                    key={i}
                    style={{
                        position: "absolute",
                        width: PIXEL * s.size,
                        height: PIXEL * s.size,
                        backgroundColor: RED,
                        opacity: stage === "mending" ? 1 : burst.interpolate({ inputRange: [0, 0.75, 1], outputRange: [1, 1, 0] }),
                        transform: [
                            { translateX: burst.interpolate({ inputRange: [0, 1], outputRange: [0, s.x] }) },
                            // Up and out first, then falling.
                            { translateY: burst.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0, s.y, s.y + 190] }) },
                            { rotate: burst.interpolate({ inputRange: [0, 1], outputRange: ["0deg", `${s.r}deg`] }) },
                        ],
                    }}
                />
            ))}
            {stage === "mending" && (
                <Animated.View style={{ position: "absolute", opacity: burst.interpolate({ inputRange: [0, 0.2, 1], outputRange: [1, 0, 0] }), transform: [{ scale: beat }] }}>
                    <PixelHeart pixel={PIXEL} />
                </Animated.View>
            )}
        </View>
    );
}

// ------------------------------------------------------------------ dark-world dust

const DUST = Array.from({ length: 22 }, (_, i) => ({
    left: `${(i * 37) % 100}%`,
    size: 2 + (i % 3) * 2,
    duration: 7000 + (i % 5) * 1700,
    delay: (i * 613) % 6000,
    color: i % 4 === 0 ? WHITE : PURPLE,
    sway: (i % 2 ? 1 : -1) * (8 + (i % 4) * 4),
}));

/** Pixel dust rising slowly through the dark, like the Dark Fountain's. */
function Dust() {
    const values = useRef(DUST.map(() => new Animated.Value(0))).current;
    useEffect(() => {
        const loops = DUST.map((d, i) => Animated.loop(Animated.sequence([
            Animated.delay(d.delay),
            Animated.timing(values[i], { toValue: 1, duration: d.duration, easing: Easing.linear, useNativeDriver: true }),
            Animated.timing(values[i], { toValue: 0, duration: 0, useNativeDriver: true }),
        ])));
        loops.forEach(l => l.start());
        return () => loops.forEach(l => l.stop());
    }, []);
    return (
        <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, overflow: "hidden" }}>
            {DUST.map((d, i) => (
                <Animated.View
                    key={i}
                    style={{
                        position: "absolute",
                        bottom: -10,
                        left: d.left as any,
                        width: d.size,
                        height: d.size,
                        backgroundColor: d.color,
                        opacity: values[i].interpolate({ inputRange: [0, 0.15, 0.8, 1], outputRange: [0, 0.7, 0.5, 0] }),
                        transform: [
                            { translateY: values[i].interpolate({ inputRange: [0, 1], outputRange: [0, -900] }) },
                            { translateX: values[i].interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, d.sway, 0] }) },
                        ],
                    }}
                />
            ))}
        </View>
    );
}

// ------------------------------------------------------------------ GAME OVER

/** Letters drop in one by one and settle with a bounce. */
function GameOver({ show }: { show: boolean; }) {
    const words = ["GAME", "OVER"];
    const letters = words.join("").split("");
    const values = useRef(letters.map(() => new Animated.Value(0))).current;
    useEffect(() => {
        if (!show) return;
        Animated.stagger(110, values.map(v => Animated.spring(v, { toValue: 1, friction: 5, tension: 70, useNativeDriver: true }))).start();
    }, [show]);
    let n = 0;
    return (
        <View style={{ alignItems: "center", opacity: show ? 1 : 0 }}>
            {words.map(word => (
                <View key={word} style={{ flexDirection: "row" }}>
                    {word.split("").map((ch, i) => {
                        const v = values[n++];
                        return (
                            <Animated.Text
                                key={`${word}${i}`}
                                style={{
                                    color: WHITE,
                                    fontSize: 54,
                                    lineHeight: 62,
                                    marginHorizontal: 3,
                                    fontFamily: FONT_BOLD,
                                    textShadowColor: "rgba(255,255,255,0.55)",
                                    textShadowRadius: 12,
                                    opacity: v,
                                    transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [-50, 0] }) }],
                                }}
                            >
                                {ch}
                            </Animated.Text>
                        );
                    })}
                </View>
            ))}
        </View>
    );
}

// ------------------------------------------------------------------ text box

function Typewriter({ lines, skip, onDone }: { lines: string[]; skip: boolean; onDone: () => void; }) {
    const full = lines.join("\n");
    const [shown, setShown] = useState(skip ? full.length : 0);
    const done = useRef(false);
    useEffect(() => {
        if (skip) setShown(full.length);
    }, [skip]);
    useEffect(() => {
        if (shown >= full.length) {
            if (!done.current) {
                done.current = true;
                onDone();
            }
            return;
        }
        const prev = full[shown - 1];
        const delay = prev && ".!?".includes(prev) ? 200 : prev === "," ? 100 : prev === "\n" ? 250 : 32;
        const timer = setTimeout(() => {
            if (shown % 2 === 0 && full[shown] !== " ") blip();
            setShown(n => n + 1);
        }, delay);
        return () => clearTimeout(timer);
    }, [shown, full]);

    return <Text style={{ color: WHITE, fontSize: 17, lineHeight: 27, fontFamily: FONT }}>{full.slice(0, shown)}</Text>;
}

/** A blinking arrow: the text box is finished. */
function Blink() {
    const v = useRef(new Animated.Value(1)).current;
    useEffect(() => {
        const loop = Animated.loop(Animated.sequence([
            Animated.timing(v, { toValue: 0, duration: 400, useNativeDriver: true }),
            Animated.timing(v, { toValue: 1, duration: 400, useNativeDriver: true }),
        ]));
        loop.start();
        return () => loop.stop();
    }, []);
    return <Animated.Text style={{ position: "absolute", right: 6, bottom: 2, color: WHITE, fontSize: 14, opacity: v }}>▼</Animated.Text>;
}

/** A Deltarune text box: black, with a thick white double border. */
function Box({ children, style }: { children: any; style?: any; }) {
    return (
        <View style={[{ borderWidth: 3, borderColor: WHITE, padding: 3, backgroundColor: "#000" }, style]}>
            <View style={{ borderWidth: 1, borderColor: WHITE, padding: 14, minHeight: 110 }}>{children}</View>
        </View>
    );
}

// ------------------------------------------------------------------ battle buttons

interface Choice { label: string; act: () => void; danger?: boolean; }

function Buttons({ choices, show }: { choices: Choice[]; show: boolean; }) {
    const [selected, setSelected] = useState(0);
    const appear = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        if (show) Animated.timing(appear, { toValue: 1, duration: 350, useNativeDriver: true }).start();
    }, [show]);
    if (!show) return null;
    return (
        <Animated.View style={{
            flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 10,
            opacity: appear, transform: [{ translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }],
        }}>
            {choices.map((choice, i) => {
                const on = selected === i;
                const color = on ? YELLOW : choice.danger ? RED : ORANGE;
                return (
                    <Pressable
                        key={choice.label}
                        onPressIn={() => {
                            setSelected(i);
                            blip();
                        }}
                        onPress={choice.act}
                        style={{
                            width: "48.5%",
                            minHeight: 52,
                            borderWidth: 3,
                            borderColor: color,
                            backgroundColor: on ? "rgba(255,255,0,0.08)" : "#000",
                            flexDirection: "row",
                            alignItems: "center",
                            paddingHorizontal: 10,
                            gap: 8,
                        }}
                    >
                        <View style={{ width: 22, opacity: on ? 1 : 0 }}><PixelHeart pixel={2} /></View>
                        <Text numberOfLines={2} style={{ flex: 1, color, fontSize: 15, letterSpacing: 1, fontFamily: FONT_BOLD }}>
                            {choice.label.toUpperCase()}
                        </Text>
                    </Pressable>
                );
            })}
        </Animated.View>
    );
}

// ------------------------------------------------------------------ HUD

/** "DELTACORD  LV 1  HP 0/20" with an empty HP bar. */
function Hud() {
    return (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 14, paddingTop: 6 }}>
            <Text style={{ color: WHITE, fontSize: 13, letterSpacing: 2, fontFamily: FONT_BOLD }}>DELTACORD</Text>
            <Text style={{ color: WHITE, fontSize: 13, letterSpacing: 1, fontFamily: FONT_BOLD }}>LV 1</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Text style={{ color: WHITE, fontSize: 11, fontFamily: FONT_BOLD }}>HP</Text>
                <View style={{ width: 60, height: 12, backgroundColor: RED }}>
                    <View style={{ width: 0, height: 12, backgroundColor: YELLOW }} />
                </View>
                <Text style={{ color: WHITE, fontSize: 13, fontFamily: FONT_BOLD }}>0 / 20</Text>
            </View>
        </View>
    );
}

// ------------------------------------------------------------------ screen

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
    const [skip, setSkip] = useState(false);
    const [shattered, setShattered] = useState(false);
    const [talked, setTalked] = useState(false);
    const [details, setDetails] = useState(false);
    const [copied, setCopied] = useState(false);
    const [mending, setMending] = useState(false);
    const flash = useRef(new Animated.Value(0)).current;
    const quake = useRef(new Animated.Value(0)).current;

    const onFlash = () => {
        Animated.parallel([
            Animated.sequence([
                Animated.timing(flash, { toValue: 0.85, duration: 60, useNativeDriver: true }),
                Animated.timing(flash, { toValue: 0, duration: 380, useNativeDriver: true }),
            ]),
            Animated.sequence([
                ...[8, -7, 6, -5, 3, -2, 0].map(x => Animated.timing(quake, { toValue: x, duration: 45, useNativeDriver: true })),
            ]),
        ]).start();
    };

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
            `* "${suspect.name}" knocked it over.`,
            "* Turn it off, and you can keep going.",
        ]
        : [
            "* Discord tripped and fell.",
            "* Something on this screen broke while drawing.",
            "* But you're filled with DETERMINATION.",
        ];

    const choices: Choice[] = [
        { label: "Continue", act: () => setMending(true) },
        ...(suspect ? [{
            label: `Turn off ${suspect.name}`,
            danger: true,
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
                <Dust />
                <Pressable style={{ flex: 1 }} onPress={() => !talked && setSkip(true)}>
                    <Animated.View style={{ flex: 1, transform: [{ translateX: quake }] }}>
                        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", paddingHorizontal: 18, paddingVertical: 12, gap: 16 }}>
                            <Hud />
                            <Soul
                                skip={skip}
                                mending={mending}
                                onFlash={onFlash}
                                onDone={() => setShattered(true)}
                                onMended={() => props.rerender()}
                            />
                            <GameOver show={shattered} />
                            {shattered && (
                                <Box>
                                    <Typewriter lines={lines} skip={skip} onDone={() => setTalked(true)} />
                                    {talked && <Blink />}
                                </Box>
                            )}
                            <Buttons choices={choices} show={talked && !mending} />
                            {details && (
                                <Box style={{ maxHeight: 320 }}>
                                    <ScrollView nestedScrollEnabled>
                                        <Text selectable style={{ color: "#BBBBBB", fontSize: 12, lineHeight: 17, fontFamily: MONO }}>{errorText(props.error)}</Text>
                                    </ScrollView>
                                </Box>
                            )}
                            {!talked && <Text style={{ color: "#555", fontSize: 11, textAlign: "center", fontFamily: FONT }}>tap to skip</Text>}
                            {talked && (
                                <Text style={{ color: "#555", fontSize: 11, textAlign: "center", fontFamily: FONT }}>
                                    Discord {debugInfo.discord.version} ({debugInfo.discord.build}) · Deltacord {debugInfo.bunny.version}
                                </Text>
                            )}
                        </ScrollView>
                    </Animated.View>
                </Pressable>
                <Animated.View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: WHITE, opacity: flash }} />
            </SafeAreaView>
        </SafeAreaProvider>
    </ErrorBoundary>;
}
