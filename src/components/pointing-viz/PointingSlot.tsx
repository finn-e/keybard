import React, { useEffect, useState } from "react";

import type { PointingSlotState } from "@/hooks/usePointingSlots";

import { PointingPlaceholder, POINTING_KIND_CAPTION } from "./PointingPlaceholder";
import { readPointingVizTheme, type PointingVizTheme } from "./types";

/** Inner padding between the slot outline and the drawing area, CSS px per side. */
const SLOT_INSET_PX = 4;

/** Theme tokens, re-read when the <html> class changes (light/dark switch). */
function usePointingVizTheme(): PointingVizTheme {
    const [theme, setTheme] = useState(readPointingVizTheme);
    useEffect(() => {
        if (typeof document === "undefined" || typeof MutationObserver === "undefined") return;
        const observer = new MutationObserver(() => setTheme(readPointingVizTheme()));
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
        return () => observer.disconnect();
    }, []);
    return theme;
}

export function pointingSlotTitle(slot: PointingSlotState): string {
    const side = slot.side === "left" ? "Left" : "Right";
    switch (slot.kind) {
        case "pending":
            return `${side}: detecting pointing module`;
        case "none":
            return `${side}: no pointing module (detected)`;
        default:
            return `${side}: ${slot.description ?? POINTING_KIND_CAPTION[slot.kind]} (detected)`;
    }
}

/** One hand's pointing slot in the layout viewer: the detected module's icon in an outline. */
export function PointingSlot({ slot, unitPx, style }: { slot: PointingSlotState; unitPx: number; style: React.CSSProperties }): React.JSX.Element {
    const theme = usePointingVizTheme();
    const outerW = slot.w * unitPx;
    const outerH = slot.h * unitPx;
    const width = Math.max(1, outerW - 2 * SLOT_INSET_PX);
    const height = Math.max(1, outerH - 2 * SLOT_INSET_PX);
    const title = pointingSlotTitle(slot);

    return (
        <div
            data-pointing-slot={slot.side}
            data-pointing-kind={slot.kind}
            style={{ position: "absolute", width: outerW, height: outerH, pointerEvents: "none", ...style }}
        >
            <div
                title={title}
                aria-label={title}
                role="img"
                style={{
                    position: "absolute",
                    inset: 0,
                    borderWidth: 1,
                    borderStyle: "dashed",
                    borderColor: theme.border,
                    borderRadius: 0.35 * unitPx,
                    background: theme.background,
                    pointerEvents: "auto",
                }}
            />
            <div style={{ position: "absolute", left: SLOT_INSET_PX, top: SLOT_INSET_PX, width, height, pointerEvents: "none" }}>
                <PointingPlaceholder kind={slot.kind} width={width} height={height} theme={theme} />
            </div>
        </div>
    );
}
