import React, { Component, Suspense, lazy, useEffect, useState, type ReactNode } from "react";

import type { PointingSlotState } from "@/hooks/usePointingSlots";
import { usePointingLive } from "@/hooks/usePointingLive";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

import { PointingPlaceholder, POINTING_KIND_CAPTION } from "./PointingPlaceholder";
import { readPointingVizTheme, type PointingModuleKind, type PointingVizProps, type PointingVizTheme } from "./types";

type VizComponent = (props: PointingVizProps) => React.JSX.Element;

// Loaded on first use, so boards without a pointing slot never download them.
const LAZY_VIZ: Partial<Record<PointingModuleKind, React.LazyExoticComponent<VizComponent>>> = {
    trackball: lazy(() => import("./TrackballFlowViz").then((m) => ({ default: m.TrackballFlowViz }))),
    touchpad: lazy(() => import("./TouchpadViz").then((m) => ({ default: m.TouchpadViz }))),
    trackpoint: lazy(() => import("./TrackpointViz").then((m) => ({ default: m.TrackpointViz }))),
};

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

/** A viz that throws (or fails to load) falls back to the still icon instead of taking the layout down. */
class VizBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
    state = { failed: false };
    static getDerivedStateFromError() {
        return { failed: true };
    }
    componentDidCatch(error: unknown) {
        console.warn("Pointing slot animation failed:", error);
    }
    render() {
        return this.state.failed ? this.props.fallback : this.props.children;
    }
}

export function pointingSlotTitle(slot: PointingSlotState): string {
    const side = slot.side === "left" ? "Left" : "Right";
    if (slot.demo) return `${side}: ${POINTING_KIND_CAPTION[slot.kind]} (demo)`;
    switch (slot.kind) {
        case "pending":
            return `${side}: detecting pointing module`;
        case "none":
            return slot.widget ? `${side}: no pointing module (detected)` : `${side}: pointing module not reported`;
        default:
            return `${side}: ${slot.description ?? POINTING_KIND_CAPTION[slot.kind]} (detected)`;
    }
}

/**
 * One hand's pointing slot in the layout viewer: the module's animation driven by
 * live (or demo) motion, or a still icon in a dashed outline.
 */
export function PointingSlot({ slot, unitPx, style }: { slot: PointingSlotState; unitPx: number; style: React.CSSProperties }): React.JSX.Element {
    const reducedMotion = usePrefersReducedMotion();
    const theme = usePointingVizTheme();
    const Viz = LAZY_VIZ[slot.kind];
    const source = usePointingLive(slot.side, Boolean(Viz), slot.demo ? slot.kind : undefined);

    const outerW = slot.w * unitPx;
    const outerH = slot.h * unitPx;
    const live = Boolean(Viz && source);
    const width = Math.max(1, outerW - 2 * SLOT_INSET_PX);
    const height = Math.max(1, outerH - 2 * SLOT_INSET_PX);
    const title = pointingSlotTitle(slot);
    const placeholder = <PointingPlaceholder kind={slot.kind} width={width} height={height} theme={theme} />;

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
                    // The outline marks an empty or undetected slot; a live module draws its own housing.
                    borderWidth: live ? 0 : 1,
                    borderStyle: "dashed",
                    borderColor: theme.border,
                    borderRadius: 0.35 * unitPx,
                    background: live ? "transparent" : theme.background,
                    pointerEvents: "auto",
                }}
            />
            <div
                style={{
                    position: "absolute",
                    left: SLOT_INSET_PX,
                    top: SLOT_INSET_PX,
                    width,
                    height,
                    pointerEvents: "none",
                }}
            >
                {Viz && source ? (
                    <VizBoundary key={slot.kind} fallback={placeholder}>
                        <Suspense fallback={placeholder}>
                            <Viz source={source} side={slot.side} width={width} height={height} reducedMotion={reducedMotion} theme={theme} sensor={slot.sensor} />
                        </Suspense>
                    </VizBoundary>
                ) : (
                    placeholder
                )}
            </div>
        </div>
    );
}
