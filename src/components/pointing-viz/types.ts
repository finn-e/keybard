// Types for each hand's pointing slot in the layout viewer. Nothing here may
// import React components.

export type PointingSide = "left" | "right";

/**
 * What sits in a hand's pointing slot.
 * - "pending": connected, but the board has not finished probing (0x18 says 0xFF).
 * - "unknown": the trackball bus answered with an ID we don't know (0x2C detected=4),
 *   or the hand never reported a module (0x18 still 0xFF after the last read).
 */
export type PointingModuleKind = "none" | "pending" | "unknown" | "trackball" | "touchpad" | "trackpoint";

/** The finer detail behind a kind, for tooltips only. */
export type PointingSensor = "pmw3360" | "pmw3389" | "azoteq" | "trackpoint";

/** Colors resolved from the app's CSS tokens (works in light and dark). */
export interface PointingVizTheme {
    /** Icon strokes. */
    foreground: string;
    /** Captions. */
    muted: string;
    /** Highlight color. */
    accent: string;
    /** Slot outline. */
    border: string;
    /** Slot fill. */
    background: string;
}

export const DEFAULT_POINTING_VIZ_THEME: PointingVizTheme = {
    foreground: "#1e293b",
    muted: "#94a3b8",
    accent: "#0ea5e9",
    border: "#cbd5e1",
    background: "transparent",
};

/**
 * Reads the theme from computed CSS variables on `el` (default: documentElement).
 * Re-call when the `.dark` class changes. Falls back to the defaults per token.
 */
export function readPointingVizTheme(el?: Element | null): PointingVizTheme {
    const target = el ?? (typeof document !== "undefined" ? document.documentElement : null);
    if (!target || typeof getComputedStyle === "undefined") return DEFAULT_POINTING_VIZ_THEME;
    const style = getComputedStyle(target);
    const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
    return {
        foreground: read("--foreground", DEFAULT_POINTING_VIZ_THEME.foreground),
        muted: read("--muted-foreground", DEFAULT_POINTING_VIZ_THEME.muted),
        accent: read("--kb-pointing-accent", read("--chart-1", DEFAULT_POINTING_VIZ_THEME.accent)),
        border: read("--border", DEFAULT_POINTING_VIZ_THEME.border),
        background: DEFAULT_POINTING_VIZ_THEME.background,
    };
}
