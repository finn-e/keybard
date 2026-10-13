import { CircleDot, CircleHelp, CircleOff, Crosshair, Loader, RectangleHorizontal, type LucideIcon } from "lucide-react";
import type React from "react";

import type { PointingModuleKind, PointingVizTheme } from "./types";

const ICONS: Record<PointingModuleKind, { Icon: LucideIcon; caption: string }> = {
    none: { Icon: CircleOff, caption: "None" },
    pending: { Icon: Loader, caption: "Detecting" },
    unknown: { Icon: CircleHelp, caption: "Unknown" },
    trackball: { Icon: CircleDot, caption: "Trackball" },
    touchpad: { Icon: RectangleHorizontal, caption: "Touchpad" },
    trackpoint: { Icon: Crosshair, caption: "TrackPoint" },
};

/** Captions for each kind, also used in slot tooltips. */
export const POINTING_KIND_CAPTION: Record<PointingModuleKind, string> = Object.fromEntries(
    Object.entries(ICONS).map(([k, v]) => [k, v.caption]),
) as Record<PointingModuleKind, string>;

/**
 * A still icon for a pointing slot: no module, still detecting, an unknown
 * module, or a known module with no live data.
 */
export function PointingPlaceholder({ kind, width, height, theme }: { kind: PointingModuleKind; width: number; height: number; theme: PointingVizTheme }): React.JSX.Element {
    const { Icon, caption } = ICONS[kind] ?? ICONS.unknown;
    const size = Math.max(12, Math.round(Math.min(width, height) * 0.4));
    return (
        <div
            data-pointing-placeholder={kind}
            aria-hidden="true"
            style={{
                width,
                height,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 2,
                color: theme.muted,
                overflow: "hidden",
            }}
        >
            <Icon width={size} height={size} strokeWidth={1.5} className={kind === "pending" ? "kb-pointing-spin" : undefined} />
            <span style={{ fontSize: 10, lineHeight: "12px", whiteSpace: "nowrap" }}>{caption}</span>
        </div>
    );
}
