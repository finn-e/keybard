// Shared contract for the pointing-module visualizations drawn in each hand's
// pointing slot. See docs/pointing-fragments-spec.md. Every viz component imports
// from here; nothing here may import React components.

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

/**
 * The single mode a hand's graphic animates for, derived per sample with this
 * priority: scroll > precision > boost > pointer.
 * - scroll: this half's motion is converted to scroll (saved per-half scroll
 *   setting XOR scroll hold/toggle).
 * - precision: a sniper key is active (global).
 * - boost: a boost key is active (global).
 */
export type PointingMode = "pointer" | "scroll" | "precision" | "boost";

/** Axis scroll lock state (global): free, or locked to one axis. */
export type AxisLock = "free" | "vertical" | "horizontal";

/** One touch point, normalized to the pad: 0..1 left→right, 0..1 top→bottom. */
export interface TouchPoint {
    x: number;
    y: number;
}

/**
 * One hand's motion over one poll window. Units are raw sensor counts (after the
 * firmware's rotation/invert, before sniper/boost/scroll conversion), summed over
 * the window `dtMs`. Divide by dtMs for a rate.
 */
export interface PointingLiveSample {
    /** performance.now() when the sample was received (or simulated). */
    t: number;
    /** Milliseconds of motion this sample covers (firmware elapsed byte, or poll interval). */
    dtMs: number;
    dx: number;
    dy: number;
    /** Wheel units the driver itself produced (e.g. Azoteq two-finger scroll). +v = up, +h = right. */
    h: number;
    v: number;
    /** HID button bits OR'ed over the window (bit 0 = button 1). */
    buttons: number;
    mode: PointingMode;
    /** Raw mode facts behind `mode`, for viz that want more than the one enum. */
    scrolling: boolean;
    precision: boolean;
    boost: boolean;
    axisLock: AxisLock;
    naturalScroll: boolean;
    autoMouseLayer: boolean;
    /** dx/dy hit the int16 clamp: draw at maximum. */
    saturated: boolean;
    /** Present only when the firmware reports touch positions (touch-valid bit). */
    touches?: TouchPoint[];
    /** Finger count when known (0..3); undefined when the board does not report it. */
    fingers?: number;
}

/** A live or simulated stream of samples for one hand. */
export interface PointingSampleSource {
    /** Latest sample, or null before the first one. Cheap; call it every frame. */
    latest(): PointingLiveSample | null;
    /** Called for every new sample. Returns an unsubscribe function. */
    subscribe(listener: (sample: PointingLiveSample) => void): () => void;
}

/** Colors resolved from the app's CSS tokens (works in light and dark). */
export interface PointingVizTheme {
    /** Primary marks: arrows, dots, particles. */
    foreground: string;
    /** Secondary marks: trails, grid, idle state. */
    muted: string;
    /** Highlight for the active mode (scroll/precision/boost accents). */
    accent: string;
    /** Slot outline. */
    border: string;
    /** Slot fill (behind the canvas). */
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

/** Props every visualization component (trackball, touchpad, trackpoint) takes. */
export interface PointingVizProps {
    source: PointingSampleSource;
    side: PointingSide;
    /** CSS pixel size of the drawing area; the canvas backing store is size * devicePixelRatio. */
    width: number;
    height: number;
    /** When true: no continuous animation; redraw a static frame only when a sample arrives. */
    reducedMotion: boolean;
    theme: PointingVizTheme;
    sensor?: PointingSensor;
    className?: string;
}

/** Time constant for velocity smoothing (exponential), ms. */
export const POINTING_SMOOTHING_MS = 120;
/** No motion for this long counts as idle: the graphic eases to its idle state. */
export const POINTING_IDLE_MS = 1500;
/**
 * Speed (counts per ms) drawn at full scale. Speeds are mapped with
 * normalizeSpeed() so slow motion is still visible.
 */
export const POINTING_FULL_SCALE_COUNTS_PER_MS = 4;

/** 0..1 visual magnitude for a rate in counts/ms (soft-saturating). */
export function normalizeSpeed(countsPerMs: number): number {
    const x = Math.abs(countsPerMs) / POINTING_FULL_SCALE_COUNTS_PER_MS;
    return 1 - Math.exp(-2.5 * x);
}

/**
 * Sizes a canvas for crisp drawing at devicePixelRatio and returns its 2D context
 * already scaled to CSS pixels, or null (jsdom, or no 2D support). Callers must
 * treat null as "draw nothing" and never throw.
 */
export function setupPointingCanvas(canvas: HTMLCanvasElement, width: number, height: number): CanvasRenderingContext2D | null {
    const dpr = typeof window !== "undefined" && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    const w = Math.max(1, Math.round(width * dpr));
    const h = Math.max(1, Math.round(height * dpr));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    let ctx: CanvasRenderingContext2D | null = null;
    try {
        ctx = canvas.getContext("2d");
    } catch {
        ctx = null;
    }
    if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
}

/** Derives the single animation mode from the raw facts (priority scroll > precision > boost > pointer). */
export function derivePointingMode(f: { scrolling: boolean; precision: boolean; boost: boolean }): PointingMode {
    if (f.scrolling) return "scroll";
    if (f.precision) return "precision";
    if (f.boost) return "boost";
    return "pointer";
}
