import { useCallback, useEffect, useMemo, useState } from "react";

import { pointingDemo } from "@/features/pointing-demo";
import { notifyHostPointingLook } from "@/features/trainer/host-pointing";
import { usePointingKinds, usePointingLive } from "@/hooks/usePointingDevices";
import { useIsDark } from "@/lib/theme";
import { setBall, useBalls } from "@/services/pointing-look.service";
import type { KeyboardInfo } from "@/types/keyboard.types";
import { placeDevice, type KeyRect } from "@/utils/pointing-geometry";
import { boostLabel, pointingFactors, sniperLabel } from "@/utils/pointing-multiplier";
import { BallMenu } from "./BallMenu";
import { PointingDevice } from "./PointingDevice";
import { BALL_GLOSS, BALL_SPARKLE, type BallId } from "./webgl/materials";
import type { PillColors } from "./overlay-draw";


/** The pill colors from the theme tokens (--kb-pointing-pill-*). */
export function pillColorsFromTokens(host = false): PillColors {
    const fallback = host ? { bg: "rgba(255,255,255,0.94)", fg: "#111214" } : { bg: "#000000", fg: "#ffffff" };
    if (typeof document === "undefined") return { ...fallback, shadow: host };
    const cs = getComputedStyle(document.documentElement);
    const name = host ? "--kb-pointing-host-pill" : "--kb-pointing-pill";
    return {
        bg: cs.getPropertyValue(`${name}-bg`).trim() || fallback.bg,
        fg: cs.getPropertyValue(`${name}-fg`).trim() || fallback.fg,
        shadow: host,
    };
}

interface Props {
    keyboard: KeyboardInfo;
    /** Key rects as drawn, in key units. */
    keys: KeyRect[];
    unitPx: number;
}

/**
 * Each hand's pointing device in the layout, at true size beside the thumbs:
 * drawn as the physical object, live from the board (or the review demo).
 */
export function PointingLayer({ keyboard, keys, unitPx }: Props) {
    const kinds = usePointingKinds();
    const any = !!(kinds.left || kinds.right);
    const live = usePointingLive(any);
    const balls = useBalls(keyboard.kbid);
    // Fixed looks; saved values from the old sliders are not read.
    const gloss = BALL_GLOSS;
    const sparkle = BALL_SPARKLE;
    const dark = useIsDark();
    const factors = useMemo(() => pointingFactors(keyboard.keymap), [keyboard.keymap]);
    const labels = useMemo(() => ({ sniper: sniperLabel(factors.sniperDivisor), boost: boostLabel(factors.boostFactor) }), [factors]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const pillColors = useMemo(() => pillColorsFromTokens(false), [dark]);
    const demo = pointingDemo();
    const [moving, setMoving] = useState<"left" | "right">(demo?.hand ?? (kinds.right ? "right" : "left"));
    const [menu, setMenu] = useState<{ side: "left" | "right"; x: number; y: number } | null>(null);
    const onMoved = useCallback((side: "left" | "right") => setMoving((m) => (m === side ? m : side)), []);
    const closeMenu = useCallback(() => setMenu(null), []);

    // The free-space search is not free: only redo it when the keys actually move.
    const keySig = keys.map((k) => `${k.x},${k.y},${k.w},${k.h}`).join(";");
    const placements = useMemo(() => ({
        left: kinds.left ? placeDevice(keys, "left", kinds.left === "trackball" ? "ball" : "pad", balls.left) : null,
        right: kinds.right ? placeDevice(keys, "right", kinds.right === "trackball" ? "ball" : "pad", balls.right) : null,
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [keySig, kinds.left, kinds.right, balls.left, balls.right]);

    // Keybard Overlay draws the same balls, gloss and sparkle (only when the overlay app is in use).
    useEffect(() => {
        if (any) notifyHostPointingLook(keyboard.kbid, balls, gloss, sparkle);
    }, [any, keyboard.kbid, balls.left, balls.right, gloss, sparkle]); // eslint-disable-line react-hooks/exhaustive-deps

    if (!any) return null;
    const moverHas = (side: "left" | "right") => !!placements[side];
    const modesAt: "left" | "right" = moverHas(moving) ? moving : moverHas("right") ? "right" : "left";

    const pick = (side: "left" | "right", ball: BallId) => setBall(keyboard.kbid, side, ball);

    return (
        <div className="absolute inset-0 pointer-events-none" data-pointing-layer="true" data-pointing-source={live.source}>
            {(["left", "right"] as const).map((side) => {
                const pl = placements[side];
                if (!pl) return null;
                return (
                    <PointingDevice
                        key={side}
                        placement={pl}
                        unitPx={unitPx}
                        ball={balls[side]}
                        gloss={gloss}
                        sparkle={sparkle}
                        theme={dark ? "dark" : "light"}
                        feed={live.feed}
                        sniper={live.sniper}
                        boost={live.boost}
                        showModes={modesAt === side}
                        labels={labels}
                        pillColors={pillColors}
                        onMoved={onMoved}
                        onMenu={(x, y) => setMenu({ side, x, y })}
                    />
                );
            })}
            {menu && (
                <BallMenu side={menu.side} current={balls[menu.side]} x={menu.x} y={menu.y} onPick={(b) => pick(menu.side, b)} onClose={closeMenu} />
            )}
        </div>
    );
}
