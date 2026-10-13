// Deterministic simulated pointing samples, for demo mode (?pointingDemo=...) and
// tests. simulateSample() is a pure function of (module, side, time, options):
// the same inputs always give the same sample. createSimulatedSource() wraps it in
// a timer-driven PointingSampleSource. See docs/pointing-fragments-spec.md.

import {
    derivePointingMode,
    type AxisLock,
    type PointingLiveSample,
    type PointingMode,
    type PointingModuleKind,
    type PointingSampleSource,
    type PointingSide,
    type TouchPoint,
} from "./types";

/** The modules a demo can show. */
export type SimulatedModule = Extract<PointingModuleKind, "trackball" | "touchpad" | "trackpoint" | "none">;

/** One phase of the demo cycle: which mode, and for how long. "idle" = no motion. */
export interface SimPhase {
    mode: PointingMode | "idle";
    ms: number;
    axisLock?: AxisLock;
}

/** Default cycle (14 s): pointer, scroll, precision, boost, idle. */
export const DEFAULT_SIM_CYCLE: readonly SimPhase[] = [
    { mode: "pointer", ms: 4000 },
    { mode: "scroll", ms: 3000, axisLock: "vertical" },
    { mode: "precision", ms: 3000 },
    { mode: "boost", ms: 2000 },
    { mode: "idle", ms: 2000 },
];

export interface SimulateOptions {
    /** Any integer; changes phase offsets and wobble. Default 1. */
    seed?: number;
    /** Pin one mode instead of cycling (demo ?pointingDemoMode=scroll). */
    mode?: PointingMode | "idle";
    cycle?: readonly SimPhase[];
    /** Window each sample covers, ms. Default 33. */
    dtMs?: number;
}

export const SIM_INTERVAL_MS = 33;

/** Small deterministic hash -> [0, 1). */
function hash01(n: number): number {
    let x = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b);
    x ^= x >>> 13;
    x = Math.imul(x, 0xc2b2ae35);
    x ^= x >>> 16;
    return (x >>> 0) / 4294967296;
}

function phaseAt(tMs: number, cycle: readonly SimPhase[], offsetMs: number): { phase: SimPhase; into: number } {
    const total = cycle.reduce((a, p) => a + p.ms, 0);
    if (total <= 0) return { phase: { mode: "pointer", ms: 1 }, into: 0 };
    let t = (((tMs + offsetMs) % total) + total) % total;
    for (const phase of cycle) {
        if (t < phase.ms) return { phase, into: t };
        t -= phase.ms;
    }
    return { phase: cycle[cycle.length - 1], into: 0 };
}

/** Velocity (counts/ms) of a smooth Lissajous-like path, mirrored for the right hand. */
function velocity(tMs: number, seed: number, side: PointingSide, scale: number): { vx: number; vy: number } {
    const a = 1 + hash01(seed) * 0.5;
    const b = 1.3 + hash01(seed + 7) * 0.5;
    const s = tMs / 1000;
    const mirror = side === "right" ? -1 : 1;
    return {
        vx: mirror * scale * Math.cos(a * s * 1.7),
        vy: scale * Math.sin(b * s * 1.3 + 0.6),
    };
}

/**
 * The sample a simulated module would report for the window ending at tMs.
 * module "none" always returns a motionless pointer sample.
 */
export function simulateSample(
    module: SimulatedModule,
    side: PointingSide,
    tMs: number,
    options: SimulateOptions = {},
): PointingLiveSample {
    const seed = options.seed ?? 1;
    const dtMs = options.dtMs ?? SIM_INTERVAL_MS;
    const cycle = options.cycle ?? DEFAULT_SIM_CYCLE;
    const offset = side === "right" ? 1700 + Math.floor(hash01(seed) * 1000) : 0;
    const phase: SimPhase = options.mode ? { mode: options.mode, ms: 1 } : phaseAt(tMs, cycle, offset).phase;

    const idle = module === "none" || phase.mode === "idle";
    const mode: PointingMode = phase.mode === "idle" ? "pointer" : phase.mode;
    const flags = { scrolling: mode === "scroll", precision: mode === "precision", boost: mode === "boost" };
    const axisLock: AxisLock = flags.scrolling ? phase.axisLock ?? "free" : "free";

    // Trackpoint: pressure-like pushes that rise and fall; others: continuous glide.
    let speed = module === "trackpoint" ? 2.2 * Math.max(0, Math.sin((tMs / 1000) * 2.1)) : 1.6;
    if (flags.precision) speed *= 0.3;
    if (flags.boost) speed *= 1.8;
    const { vx, vy } = idle ? { vx: 0, vy: 0 } : velocity(tMs, seed, side, speed);

    let dx = Math.round(vx * dtMs);
    let dy = Math.round(vy * dtMs);
    let h = 0;
    let v = 0;
    if (flags.scrolling) {
        if (axisLock === "vertical") dx = 0;
        if (axisLock === "horizontal") dy = 0;
        // Wheel units the driver itself emits (touchpad two-finger scroll).
        if (module === "touchpad") {
            v = Math.max(-127, Math.min(127, Math.round(-dy / 8)));
            h = Math.max(-127, Math.min(127, Math.round(dx / 8)));
        }
    }

    const sample: PointingLiveSample = {
        t: tMs,
        dtMs,
        dx,
        dy,
        h,
        v,
        buttons: 0,
        mode: derivePointingMode(flags),
        ...flags,
        axisLock,
        naturalScroll: false,
        autoMouseLayer: !idle && !flags.scrolling,
        saturated: false,
    };

    if (module === "touchpad" && !idle) {
        // Positions on the pad follow the integral of the velocity path (a closed orbit).
        const s = tMs / 1000;
        const mirror = side === "right" ? -1 : 1;
        const p: TouchPoint = {
            x: 0.5 + mirror * 0.32 * Math.sin(s * 1.7 * (1 + hash01(seed) * 0.5)),
            y: 0.5 - 0.32 * Math.cos(s * 1.3 * (1.3 + hash01(seed + 7) * 0.5) + 0.6),
        };
        const touches: TouchPoint[] = [clampTouch(p)];
        if (flags.scrolling) touches.push(clampTouch({ x: p.x + 0.18, y: p.y }));
        sample.touches = touches;
        sample.fingers = touches.length;
    }
    return sample;
}

function clampTouch(p: TouchPoint): TouchPoint {
    return { x: Math.min(1, Math.max(0, p.x)), y: Math.min(1, Math.max(0, p.y)) };
}

export interface SimulatedSource extends PointingSampleSource {
    /** Stops the timer. Safe to call twice. */
    stop(): void;
}

/**
 * A PointingSampleSource that emits simulateSample() every intervalMs using
 * `now` (default performance.now) for time. Starts immediately.
 */
export function createSimulatedSource(
    module: SimulatedModule,
    side: PointingSide,
    options: SimulateOptions & { intervalMs?: number; now?: () => number } = {},
): SimulatedSource {
    const intervalMs = options.intervalMs ?? SIM_INTERVAL_MS;
    const now = options.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
    const listeners = new Set<(s: PointingLiveSample) => void>();
    let last: PointingLiveSample | null = null;
    const tick = () => {
        last = simulateSample(module, side, now(), { ...options, dtMs: intervalMs });
        for (const l of listeners) l(last);
    };
    tick();
    let timer: ReturnType<typeof setInterval> | undefined = setInterval(tick, intervalMs);
    return {
        latest: () => last,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        stop() {
            if (timer !== undefined) clearInterval(timer);
            timer = undefined;
            listeners.clear();
        },
    };
}

export interface PointingDemoConfig {
    left: SimulatedModule;
    right: SimulatedModule;
    mode?: PointingMode | "idle";
    /** ?pointingDemo=tour: each hand steps through trackball, touchpad and trackpoint. */
    tour?: boolean;
}

/** The modules a demo tour steps through, and how long each is shown. */
export const POINTING_DEMO_TOUR: readonly SimulatedModule[] = ["trackball", "touchpad", "trackpoint"];
export const POINTING_DEMO_TOUR_MS = 6000;

/** The module a tour shows on one hand at a step: the hands start one module apart. */
export function pointingDemoTourModule(side: "left" | "right", step: number): SimulatedModule {
    const n = POINTING_DEMO_TOUR.length;
    return POINTING_DEMO_TOUR[(((step + (side === "left" ? 0 : 1)) % n) + n) % n];
}

const DEMO_MODULES: readonly SimulatedModule[] = ["trackball", "touchpad", "trackpoint", "none"];
const DEMO_MODES: readonly (PointingMode | "idle")[] = ["pointer", "scroll", "precision", "boost", "idle"];

/**
 * Parses the demo URL params from a location.search string:
 *   ?pointingDemo=trackball,touchpad   (left,right)
 *   ?pointingDemo=trackpoint           (both hands)
 *   ?pointingDemo=1                    (trackball,touchpad)
 *   ?pointingDemo=tour                 (each hand steps through all three modules)
 *   &pointingDemoMode=scroll           (pin one mode; otherwise cycle)
 * Returns null when pointingDemo is absent or "0"/"off". Unknown names become "none".
 */
export function parsePointingDemo(search: string): PointingDemoConfig | null {
    const params = new URLSearchParams(search);
    const raw = params.get("pointingDemo");
    if (raw === null || raw === "0" || raw.toLowerCase() === "off") return null;
    const pick = (name: string | undefined): SimulatedModule => {
        const n = (name ?? "").trim().toLowerCase() as SimulatedModule;
        return DEMO_MODULES.includes(n) ? n : "none";
    };
    let left: SimulatedModule;
    let right: SimulatedModule;
    let tour = false;
    if (raw.trim().toLowerCase() === "tour" || raw.trim().toLowerCase() === "all") {
        tour = true;
        left = pointingDemoTourModule("left", 0);
        right = pointingDemoTourModule("right", 0);
    } else if (raw === "" || raw === "1" || raw.toLowerCase() === "on") {
        left = "trackball";
        right = "touchpad";
    } else {
        const parts = raw.split(",");
        left = pick(parts[0]);
        right = parts.length > 1 ? pick(parts[1]) : left;
    }
    const modeRaw = params.get("pointingDemoMode")?.trim().toLowerCase();
    const mode = DEMO_MODES.find((m) => m === modeRaw);
    const config: PointingDemoConfig = mode ? { left, right, mode } : { left, right };
    if (tour) config.tour = true;
    return config;
}
