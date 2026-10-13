// TrackpointViz: a tall rubber TrackPoint nub (the kind Svalboard uses) seen in a
// three-quarter view, camera above and in front. A short collar sits on a small
// module plate; a slender tapered stalk rises from it to a rounded rubber cap with
// a dimpled top. Matte rubber, lit softly from the upper left.
//
// The push (smoothed dx, dy rate) bends the stalk like a palm tree in the wind:
// the base stays planted, the stalk curves (stiffer at the bottom, bending more
// toward the top) and the cap tilts to follow it. dx bends it sideways; dy bends it
// toward the viewer (+dy, the top moves down the screen and the stalk foreshortens)
// or away (-dy). On release it springs back with a damped sway. A thin arrow on the
// ground grows from the base in the push direction, its length the push force.
//
// Modes (docs/pointing-fragments-spec.md, section D):
//   pointer   bend + ground force arrow
//   scroll    bend only along the scroll axis; chevrons beside the nub show the
//             scroll direction (naturalScroll flips the chevrons, not the bend)
//   precision stiffer (much smaller bend), fine reticle on the ground
//   boost     bends harder, wind streaks blow past in the push direction
//   squish    Z pressure (pushing straight down): the stalk compresses and bulges,
//             the cap flattens and spreads, then it boings back with an overshoot.
//             The board doesn't report pressure yet, so a button press triggers it;
//             an optional `pressure` (0..1) on the sample drives the depth if present.
//
// The stalk only flexes: the cap is carried by the minimal rotation that tilts the
// vertical onto the stalk's tip tangent, so nothing ever twists about its own axis.
//   idle      the nub stands straight and still; the rAF loop stops once settled
//
// All animation state lives in refs; the per-frame path allocates nothing except
// the canvas gradients (as the trackball does).

import { useEffect, useRef, useState, type JSX } from "react";

import {
    POINTING_IDLE_MS,
    POINTING_SMOOTHING_MS,
    normalizeSpeed,
    setupPointingCanvas,
    type AxisLock,
    type PointingLiveSample,
    type PointingMode,
    type PointingVizProps,
    type PointingVizTheme,
} from "./types";

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** Natural sway frequency of the stalk, Hz. */
const SWAY_HZ = 2.4;
/** Spring constant (1/s²) from the sway frequency. */
const SPRING_K = (2 * Math.PI * SWAY_HZ) ** 2;
/** Damping ratio while a push is held (follows the push without wobbling much). */
const PUSH_ZETA = 0.6;
/** Damping ratio after release: a couple of decaying sways, like a palm after a gust. */
const SWAY_ZETA = 0.13;
/** Bend per mode, as a multiple of the normalized push force. */
const MODE_GAIN: Record<PointingMode, number> = { pointer: 0.95, scroll: 0.85, precision: 0.38, boost: 1.3 };
/** Tip angle from vertical at a bend of 1, radians (~57°). */
const BEND_MAX_RAD = 1.0;
/** Hard cap on the tip angle (overshoot included), radians (~83°). */
const BEND_LIMIT_RAD = 1.45;
/** Curvature profile exponent: >1 keeps the base stiff and bends the top more. */
const BEND_PROFILE = 1.5;
/** Rate smoothing time constant once the push is released, ms. */
const RELEASE_SMOOTHING_MS = 30;
/** Largest integration step for the spring, ms (sub-stepped above this). */
const MAX_SUBSTEP_MS = 8;
/** Longest frame dt considered, ms (tab switches, debugger pauses). */
const MAX_FRAME_DT_MS = 100;
/** Ease mode decorations into / out of the idle state over this long, ms. */
const IDLE_EASE_MS = 400;
/** Mode decorations fade in over this long, ms. */
const MODE_FADE_MS = 200;
/** A button sample keeps the cap pressed this long (re-armed by every sample), ms. */
const PRESS_HOLD_MS = 120;
/** Squish spring: natural frequency (Hz) and damping (low, so it boings). */
const SQUISH_HZ = 4.5;
const SQUISH_K = (2 * Math.PI * SQUISH_HZ) ** 2;
const SQUISH_ZETA = 0.28;
/** Drawn squish is clamped to this range (overshoot both ways). */
const SQUISH_MIN = -0.6;
const SQUISH_MAX = 1.35;
/** Wheel units are coarse: one wheel unit ≈ this many counts for the visual. */
const WHEEL_TO_COUNTS = 8;
/** Decoration animation (streaks, chevrons): cycles per second at full force. */
const DECOR_RATE = 1.6;
/** Elevation of the camera above the ground plane, radians (~53°): fairly top-down. */
const CAMERA_ELEVATION = 0.92;
/** Camera azimuth, radians (~20°): a three-quarter view, so a lean away from the
 * viewer drifts up and to the right instead of hiding behind the stalk. */
const CAMERA_AZIMUTH = 0.35;
/** Spine samples along the stalk. */
const SPINE_SEGMENTS = 16;
/** Points per ring when building the cap's silhouette. */
const RING_POINTS = 20;
/** Directions sampled for the cap's convex silhouette. */
const HULL_DIRECTIONS = 36;
/** Settle thresholds. */
const SETTLE_BEND = 2e-3;
const SETTLE_BEND_VEL = 2e-2;

// ---------------------------------------------------------------------------
// Pure state and math (exported for unit tests)
// ---------------------------------------------------------------------------

export interface TrackpointState {
    /** Smoothed rate, counts/ms, screen coordinates (scroll mode substitutes wheel units). */
    vx: number;
    vy: number;
    /** Push force, 0..1 per magnitude: x = sideways (+right), y = toward the viewer (+dy). */
    fx: number;
    fy: number;
    /** Spring-driven bend (same axes as the force; ≈0..1.3, may overshoot). */
    bx: number;
    by: number;
    /** Bend velocity, per second. */
    bvx: number;
    bvy: number;
    mode: PointingMode;
    modeSince: number;
    /** 0 = active .. 1 = fully idle (linear; eased when drawn). Fades mode decorations. */
    idle: number;
    lastSampleT: number;
    lastMotionT: number;
    /** Decoration animation phase (wind streaks, scroll chevrons), 0..1. */
    phase: number;
    scrollAxis: "vertical" | "horizontal";
    /** Last non-zero scroll direction along the axis as the content moves, ±1 (screen). */
    scrollSign: number;
    /** The cap stays pressed until this time (button held / just pressed). */
    pressUntil: number;
    /** Z squish: 0 rest, 1 fully pressed down, negative = stretched (boing overshoot). */
    squish: number;
    /** Squish velocity, per second. */
    squishV: number;
    /** Latest pressure 0..1 read off a fresh sample, or -1 when the sample has none. */
    pressure: number;
    saturated: boolean;
    axisLock: AxisLock;
    naturalScroll: boolean;
    hasSample: boolean;
}

export function createTrackpointState(): TrackpointState {
    return {
        vx: 0,
        vy: 0,
        fx: 0,
        fy: 0,
        bx: 0,
        by: 0,
        bvx: 0,
        bvy: 0,
        mode: "pointer",
        modeSince: -Infinity,
        idle: 1,
        lastSampleT: Number.NaN,
        lastMotionT: -Infinity,
        phase: 0,
        scrollAxis: "vertical",
        scrollSign: 1,
        pressUntil: -Infinity,
        squish: 0,
        squishV: 0,
        pressure: -1,
        saturated: false,
        axisLock: "free",
        naturalScroll: false,
        hasSample: false,
    };
}

function sampleHasMotion(s: PointingLiveSample): boolean {
    return s.dx !== 0 || s.dy !== 0 || s.h !== 0 || s.v !== 0 || s.saturated;
}

/**
 * Rate (counts/ms) a sample represents, in screen coordinates (+x right, +y down).
 * In scroll mode the driver's own wheel units win when present (+v = up).
 * Writes into `out` to avoid allocation.
 */
export function sampleRate(s: PointingLiveSample, out: { x: number; y: number }): { x: number; y: number } {
    const dt = s.dtMs > 0 ? s.dtMs : 1;
    let dx = s.dx;
    let dy = s.dy;
    if (s.mode === "scroll") {
        if (s.h !== 0) dx = s.h * WHEEL_TO_COUNTS;
        if (s.v !== 0) dy = -s.v * WHEEL_TO_COUNTS;
    }
    out.x = dx / dt;
    out.y = dy / dt;
    return out;
}

/** Scroll axis rule from the spec: vertical unless locked horizontal, or free and |x| > |y|. */
export function scrollAxisFor(axisLock: AxisLock, vx: number, vy: number): "vertical" | "horizontal" {
    if (axisLock === "horizontal") return "horizontal";
    if (axisLock === "vertical") return "vertical";
    return Math.abs(vx) > Math.abs(vy) ? "horizontal" : "vertical";
}

/**
 * One integration step of the bend spring toward (gx, gy), `hSec` seconds,
 * semi-implicit Euler. Damping is light once the push is released, so the stalk
 * sways back and forth a couple of times before it stands still.
 */
export function springBend(st: TrackpointState, gx: number, gy: number, hSec: number): void {
    const released = Math.abs(gx) < 1e-3 && Math.abs(gy) < 1e-3;
    const zeta = released ? SWAY_ZETA : PUSH_ZETA;
    const c = 2 * zeta * Math.sqrt(SPRING_K);
    st.bvx += (SPRING_K * (gx - st.bx) - c * st.bvx) * hSec;
    st.bvy += (SPRING_K * (gy - st.by) - c * st.bvy) * hSec;
    st.bx += st.bvx * hSec;
    st.by += st.bvy * hSec;
}

/**
 * Z pressure on a sample, 0..1, or -1 when it has none. The protocol doesn't carry
 * pressure yet; this reads an optional `pressure` field defensively so a future
 * sample type can drive the squish depth without changing this component.
 */
export function samplePressure(s: PointingLiveSample): number {
    const p = (s as PointingLiveSample & { pressure?: unknown }).pressure;
    if (typeof p !== "number" || !Number.isFinite(p)) return -1;
    return Math.max(0, Math.min(1, p));
}

/** How deep the squish should be now: the pressure if known, else 1 while a button is held. */
export function squishTargetFor(st: TrackpointState, now: number): number {
    if (st.pressure >= 0) return st.pressure;
    return now < st.pressUntil ? 1 : 0;
}

/** One semi-implicit Euler step of the squish spring (underdamped: it boings). */
export function springSquish(st: TrackpointState, target: number, hSec: number): void {
    const c = 2 * SQUISH_ZETA * Math.sqrt(SQUISH_K);
    st.squishV += (SQUISH_K * (target - st.squish) - c * st.squishV) * hSec;
    st.squish += st.squishV * hSec;
}

const rateScratch = { x: 0, y: 0 };

/**
 * Advances the animation state by one frame. `snap` (reduced motion) jumps every
 * smoothed quantity straight to its target so a single static frame is accurate.
 */
export function stepTrackpoint(
    st: TrackpointState,
    sample: PointingLiveSample | null,
    now: number,
    frameDtMs: number,
    snap = false,
): TrackpointState {
    const dt = Math.max(0, Math.min(MAX_FRAME_DT_MS, frameDtMs));

    if (sample) {
        if (!st.hasSample || sample.t !== st.lastSampleT) {
            st.hasSample = true;
            st.lastSampleT = sample.t;
            if (sampleHasMotion(sample)) st.lastMotionT = sample.t;
            if (sample.buttons !== 0 || samplePressure(sample) > 0) {
                st.pressUntil = now + PRESS_HOLD_MS;
                // A click also counts as activity, so decorations don't idle mid-press.
                st.lastMotionT = Math.max(st.lastMotionT, sample.t);
            }
        }
        if (sample.mode !== st.mode) {
            st.mode = sample.mode;
            st.modeSince = now;
        }
        st.axisLock = sample.axisLock;
        st.naturalScroll = sample.naturalScroll;
    }

    // Target rate: the latest sample while it is fresh, otherwise rest.
    const fresh = sample !== null && now - sample.t <= Math.max(2.5 * sample.dtMs, 100);
    let tx = 0;
    let ty = 0;
    if (fresh && sample) {
        sampleRate(sample, rateScratch);
        tx = rateScratch.x;
        ty = rateScratch.y;
    }
    st.saturated = fresh && sample !== null && sample.saturated;

    // Exponential velocity smoothing (frame-rate independent). Smoothing hides the
    // jitter between 33 ms samples while pushing; on release (target exactly zero)
    // the rate collapses faster, so the stalk is let go and sways back.
    const released = tx === 0 && ty === 0 && !st.saturated;
    const tau = released ? RELEASE_SMOOTHING_MS : POINTING_SMOOTHING_MS;
    const a = snap ? 1 : 1 - Math.exp(-dt / tau);
    st.vx += (tx - st.vx) * a;
    st.vy += (ty - st.vy) * a;

    // Push force (0..1 magnitude). Scroll pushes only along its axis.
    st.fx = 0;
    st.fy = 0;
    if (st.mode === "scroll") {
        st.scrollAxis = scrollAxisFor(st.axisLock, st.vx, st.vy);
        const along = st.scrollAxis === "vertical" ? st.vy : st.vx;
        const sign = along > 0 ? 1 : along < 0 ? -1 : 0;
        const m = sign === 0 ? 0 : st.saturated ? 1 : normalizeSpeed(along);
        // The chevrons show which way the content scrolls (natural scrolling flips it);
        // the stalk itself always bends the way the finger pushes.
        if (sign !== 0 && m > 0.02) st.scrollSign = st.naturalScroll ? -sign : sign;
        if (st.scrollAxis === "vertical") st.fy = sign * m;
        else st.fx = sign * m;
    } else {
        const speed = Math.hypot(st.vx, st.vy);
        if (speed > 1e-6) {
            const m = st.saturated ? 1 : normalizeSpeed(speed);
            st.fx = (st.vx / speed) * m;
            st.fy = (st.vy / speed) * m;
        }
    }
    const force = Math.hypot(st.fx, st.fy);

    // Spring the bend toward the force.
    const gain = MODE_GAIN[st.mode];
    const gx = st.fx * gain;
    const gy = st.fy * gain;
    if (snap) {
        st.bx = gx;
        st.by = gy;
        st.bvx = 0;
        st.bvy = 0;
    } else {
        let remaining = dt;
        while (remaining > 0) {
            const h = Math.min(MAX_SUBSTEP_MS, remaining);
            remaining -= h;
            springBend(st, gx, gy, h / 1000);
        }
    }

    // Decoration phase (streaks, chevrons) runs only while pushing.
    if (force > 1e-3 && !snap) {
        st.phase += (DECOR_RATE * (0.35 + force) * dt) / 1000;
        st.phase -= Math.floor(st.phase);
    }

    // Z squish: pressure when the sample carries it, otherwise a button press.
    st.pressure = fresh && sample ? samplePressure(sample) : -1;
    const squishTarget = squishTargetFor(st, now);
    if (snap) {
        st.squish = squishTarget;
        st.squishV = 0;
    } else {
        let remaining = dt;
        while (remaining > 0) {
            const h = Math.min(MAX_SUBSTEP_MS, remaining);
            remaining -= h;
            springSquish(st, squishTarget, h / 1000);
        }
        if (squishTarget === 0 && Math.abs(st.squish) < 1e-3 && Math.abs(st.squishV) < 1e-2) {
            st.squish = 0;
            st.squishV = 0;
        }
    }

    // Idle easing (mode decorations only; the nub is always drawn).
    const idleTarget = !st.hasSample || now - st.lastMotionT > POINTING_IDLE_MS ? 1 : 0;
    if (snap) st.idle = idleTarget;
    else if (st.idle < idleTarget) st.idle = Math.min(idleTarget, st.idle + dt / IDLE_EASE_MS);
    else if (st.idle > idleTarget) st.idle = Math.max(idleTarget, st.idle - dt / IDLE_EASE_MS);

    return st;
}

/** True once nothing on screen will change until a new sample arrives. */
export function isTrackpointSettled(st: TrackpointState, now: number): boolean {
    return (
        st.idle >= 1 &&
        squishTargetFor(st, now) === 0 &&
        st.squish === 0 &&
        st.squishV === 0 &&
        Math.abs(st.fx) < 1e-3 &&
        Math.abs(st.fy) < 1e-3 &&
        Math.abs(st.bx) < SETTLE_BEND &&
        Math.abs(st.by) < SETTLE_BEND &&
        Math.abs(st.bvx) < SETTLE_BEND_VEL &&
        Math.abs(st.bvy) < SETTLE_BEND_VEL
    );
}

/** Tip angle from vertical (radians) for a bend vector. */
export function bendAngle(bx: number, by: number): number {
    return Math.min(BEND_LIMIT_RAD, Math.hypot(bx, by) * BEND_MAX_RAD);
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** Where everything sits for a drawing size. World units are CSS px at the base. */
export interface NubLayout {
    /** Base anchor on screen (centre of the collar's foot). */
    cx: number;
    by: number;
    /** Scale unit, px (≈ drawing height). */
    s: number;
    cosE: number;
    sinE: number;
    cosA: number;
    sinA: number;
    /** Perspective distance, px. */
    persp: number;
    plateR: number;
    collarR: number;
    collarTopR: number;
    collarH: number;
    stalkL: number;
    stalkR0: number;
    stalkR1: number;
    capR: number;
    capH: number;
}

export function createNubLayout(): NubLayout {
    return {
        cx: 0,
        by: 0,
        s: 0,
        cosE: 0,
        sinE: 0,
        cosA: 1,
        sinA: 0,
        persp: 0,
        plateR: 0,
        collarR: 0,
        collarTopR: 0,
        collarH: 0,
        stalkL: 0,
        stalkR0: 0,
        stalkR1: 0,
        capR: 0,
        capH: 0,
    };
}

/** Lays the nub out in a width × height box: centred, tall, room to bend. Writes into `out`. */
export function nubLayout(width: number, height: number, out: NubLayout): NubLayout {
    const s = Math.max(1, Math.min(height, width));
    out.s = s;
    out.cosE = Math.cos(CAMERA_ELEVATION);
    out.sinE = Math.sin(CAMERA_ELEVATION);
    out.cosA = Math.cos(CAMERA_AZIMUTH);
    out.sinA = Math.sin(CAMERA_AZIMUTH);
    out.persp = 3 * s;
    out.cx = width / 2;
    out.by = height / 2 + s * 0.2;
    out.plateR = s * 0.32;
    out.collarR = s * 0.13;
    out.collarTopR = s * 0.1;
    out.collarH = s * 0.07;
    out.stalkL = s * 0.52;
    out.stalkR0 = s * 0.042;
    out.stalkR1 = s * 0.03;
    out.capR = s * 0.085;
    out.capH = s * 0.075;
    return out;
}

/**
 * Projects a world point (x right, y up, z toward the viewer; origin at the base)
 * to the screen with mild perspective. Writes x, y and the scale into out[i..i+2].
 */
export function projectPoint(L: NubLayout, x: number, y: number, z: number, out: Float64Array, i: number): void {
    // Turn the world about the vertical by the camera azimuth, then tilt by the elevation.
    const xr = x * L.cosA - z * L.sinA;
    const zr = x * L.sinA + z * L.cosA;
    const depth = zr * L.cosE + y * L.sinE;
    const k = L.persp / Math.max(L.persp * 0.2, L.persp - depth);
    out[i] = L.cx + xr * k;
    out[i + 1] = L.by + (zr * L.sinE - y * L.cosE) * k;
    out[i + 2] = k;
}

/** The bent stalk: world-space spine points, (x, y, z) per point, SPINE_SEGMENTS + 1 points. */
export interface SpinePose {
    pts: Float64Array;
    /** Unit bend direction on the ground (x, z). */
    dirX: number;
    dirZ: number;
    /** Tip angle from vertical, radians. */
    angle: number;
}

export function createSpinePose(): SpinePose {
    return { pts: new Float64Array((SPINE_SEGMENTS + 1) * 3), dirX: 1, dirZ: 0, angle: 0 };
}

/**
 * Integrates the stalk's spine for a bend: it leaves the collar vertically (the
 * base is planted) and its angle from vertical grows as t^BEND_PROFILE up to the
 * tip angle, so the top bends more than the bottom, like a palm trunk. The arc
 * length stays `length`, so the stalk bends rather than stretches.
 */
export function computeSpine(bx: number, by: number, baseY: number, length: number, out: SpinePose): SpinePose {
    const mag = Math.hypot(bx, by);
    if (mag > 1e-6) {
        out.dirX = bx / mag;
        out.dirZ = by / mag;
    }
    const phi = bendAngle(bx, by);
    out.angle = phi;
    const p = out.pts;
    let x = 0;
    let y = baseY;
    let z = 0;
    p[0] = x;
    p[1] = y;
    p[2] = z;
    const ds = length / SPINE_SEGMENTS;
    for (let i = 1; i <= SPINE_SEGMENTS; i++) {
        const t = (i - 0.5) / SPINE_SEGMENTS;
        const alpha = phi * Math.pow(t, BEND_PROFILE);
        const lateral = Math.sin(alpha) * ds;
        x += out.dirX * lateral;
        z += out.dirZ * lateral;
        y += Math.cos(alpha) * ds;
        p[i * 3] = x;
        p[i * 3 + 1] = y;
        p[i * 3 + 2] = z;
    }
    return out;
}

// ---------------------------------------------------------------------------
// Palette (derived from the theme: light vs dark page)
// ---------------------------------------------------------------------------

/** Rough perceived lightness (0..1) of a CSS colour, or null when it can't be read. */
export function colorLightness(color: string): number | null {
    const c = color.trim().toLowerCase();
    let m = /^#([0-9a-f]{3,8})$/.exec(c);
    if (m) {
        let hex = m[1];
        if (hex.length === 3 || hex.length === 4) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
        const r = parseInt(hex.slice(0, 2), 16) / 255;
        const g = parseInt(hex.slice(2, 4), 16) / 255;
        const b = parseInt(hex.slice(4, 6), 16) / 255;
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }
    m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(c);
    if (m) return (0.2126 * +m[1] + 0.7152 * +m[2] + 0.0722 * +m[3]) / 255;
    m = /^ok(?:lch|lab)\(\s*([\d.]+)(%?)/.exec(c);
    if (m) return m[2] ? +m[1] / 100 : +m[1];
    m = /^(?:lch|lab)\(\s*([\d.]+)/.exec(c);
    if (m) return +m[1] / 100;
    m = /^hsla?\(\s*[\d.]+(?:deg)?[\s,]+[\d.]+%[\s,]+([\d.]+)%/.exec(c);
    if (m) return +m[1] / 100;
    return null;
}

interface NubPalette {
    dark: boolean;
    rubber: string;
    rubberLit: string;
    rubberShade: string;
    capTop: string;
    capTopLit: string;
    dimple: string;
    collarLit: string;
    collar: string;
    collarShade: string;
    collarTop: string;
    plate: string;
    shadow: string;
    rim: string;
}

const LIGHT_PALETTE: NubPalette = {
    dark: false,
    rubber: "#bf2f2b",
    rubberLit: "#d9554b",
    rubberShade: "#7a1814",
    capTop: "#cf3d36",
    capTopLit: "#e6776c",
    dimple: "rgba(70,8,6,0.5)",
    collarLit: "#6b7280",
    collar: "#3f444c",
    collarShade: "#1f2329",
    collarTop: "#565c66",
    plate: "rgba(15,23,42,0.05)",
    shadow: "rgba(15,23,42,",
    rim: "rgba(255,255,255,0)",
};

const DARK_PALETTE: NubPalette = {
    dark: true,
    rubber: "#c8352f",
    rubberLit: "#e5655a",
    rubberShade: "#7d1a15",
    capTop: "#d6443c",
    capTopLit: "#f08a7e",
    dimple: "rgba(60,6,4,0.55)",
    collarLit: "#8a93a3",
    collar: "#5a6272",
    collarShade: "#353b47",
    collarTop: "#6f7889",
    plate: "rgba(255,255,255,0.04)",
    shadow: "rgba(0,0,0,",
    rim: "rgba(255,255,255,0.16)",
};

let paletteKey = "";
let paletteCache: NubPalette = LIGHT_PALETTE;

/** Light rubber for light pages, slightly brighter rubber and lighter collar for dark ones. */
export function paletteFor(theme: PointingVizTheme): NubPalette {
    if (theme.foreground === paletteKey) return paletteCache;
    paletteKey = theme.foreground;
    const l = colorLightness(theme.foreground);
    paletteCache = l !== null && l > 0.55 ? DARK_PALETTE : LIGHT_PALETTE;
    return paletteCache;
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

function smoothstep(x: number): number {
    const t = Math.max(0, Math.min(1, x));
    return t * t * (3 - 2 * t);
}

/** Light direction on screen (upper left), unit. */
const LIGHT_X = -0.62;
const LIGHT_Y = -0.78;

// Scratch buffers (no per-frame allocation).
const layoutScratch = createNubLayout();
const spineScratch = createSpinePose();
/** Projected spine: x, y, k per point. */
const spineScreen = new Float64Array((SPINE_SEGMENTS + 1) * 3);
/** Screen normals and radii along the stalk. */
const spineNx = new Float64Array(SPINE_SEGMENTS + 1);
const spineNy = new Float64Array(SPINE_SEGMENTS + 1);
const spineR = new Float64Array(SPINE_SEGMENTS + 1);
const spineLit = new Float64Array(SPINE_SEGMENTS + 1);
/** Cap rings (bottom, lower, upper, top), projected x, y, k per point. */
const CAP_RINGS = 4;
const capRing = new Float64Array(CAP_RINGS * RING_POINTS * 3);
const tmp3 = new Float64Array(3);
const tmp3b = new Float64Array(3);
const ringCos = new Float64Array(RING_POINTS);
const ringSin = new Float64Array(RING_POINTS);
for (let i = 0; i < RING_POINTS; i++) {
    ringCos[i] = Math.cos((i / RING_POINTS) * Math.PI * 2);
    ringSin[i] = Math.sin((i / RING_POINTS) * Math.PI * 2);
}
const hullCos = new Float64Array(HULL_DIRECTIONS);
const hullSin = new Float64Array(HULL_DIRECTIONS);
for (let i = 0; i < HULL_DIRECTIONS; i++) {
    hullCos[i] = Math.cos((i / HULL_DIRECTIONS) * Math.PI * 2);
    hullSin[i] = Math.sin((i / HULL_DIRECTIONS) * Math.PI * 2);
}
/** Dimples on the cap top, unit-disk coordinates (centre + two staggered rings). */
const DIMPLES: readonly number[] = (() => {
    const d: number[] = [0, 0];
    for (let i = 0; i < 6; i++) d.push(0.4 * Math.cos((i * Math.PI) / 3), 0.4 * Math.sin((i * Math.PI) / 3));
    for (let i = 0; i < 9; i++) d.push(0.74 * Math.cos(((i + 0.5) * 2 * Math.PI) / 9), 0.74 * Math.sin(((i + 0.5) * 2 * Math.PI) / 9));
    return d;
})();

/** Fills a ground-plane ellipse (circle of radius r at world (x, 0, z)) path. */
function groundEllipsePath(ctx: CanvasRenderingContext2D, L: NubLayout, x: number, z: number, r: number): void {
    projectPoint(L, x, 0, z, tmp3, 0);
    const k = tmp3[2];
    ctx.beginPath();
    ctx.ellipse(tmp3[0], tmp3[1], r * k, r * L.sinE * k, 0, 0, Math.PI * 2);
}

/** Soft elliptical ground shadow centred on world (x, z). */
function groundShadow(ctx: CanvasRenderingContext2D, L: NubLayout, pal: NubPalette, x: number, z: number, r: number, alpha: number): void {
    if (alpha <= 0.002 || r <= 0) return;
    projectPoint(L, x, 0, z, tmp3, 0);
    const k = tmp3[2];
    ctx.save();
    ctx.translate(tmp3[0], tmp3[1]);
    ctx.scale(1, L.sinE);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * k);
    g.addColorStop(0, `${pal.shadow}${alpha.toFixed(3)})`);
    g.addColorStop(0.55, `${pal.shadow}${(alpha * 0.45).toFixed(3)})`);
    g.addColorStop(1, `${pal.shadow}0)`);
    ctx.fillStyle = g;
    ctx.fillRect(-r * k, -r * k, 2 * r * k, 2 * r * k);
    ctx.restore();
}

function drawPlate(ctx: CanvasRenderingContext2D, L: NubLayout, pal: NubPalette, theme: PointingVizTheme, press: number): void {
    groundEllipsePath(ctx, L, 0, 0, L.plateR);
    ctx.fillStyle = pal.plate;
    ctx.fill();
    ctx.lineWidth = Math.max(1, L.s * 0.012);
    ctx.strokeStyle = press > 0.01 ? theme.accent : theme.border;
    ctx.globalAlpha = press > 0.01 ? 0.5 + 0.5 * press : 0.9;
    ctx.stroke();
    ctx.globalAlpha = 1;
}

function drawReticle(ctx: CanvasRenderingContext2D, L: NubLayout, theme: PointingVizTheme, alpha: number): void {
    if (alpha <= 0.002) return;
    ctx.globalAlpha = 0.5 * alpha;
    ctx.strokeStyle = theme.foreground;
    ctx.lineWidth = 1;
    groundEllipsePath(ctx, L, 0, 0, L.plateR * 0.62);
    ctx.stroke();
    // Crosshair on the ground, aligned with the screen (horizontal and depth axes).
    projectPoint(L, 0, 0, 0, tmp3, 0);
    const x0 = tmp3[0], y0 = tmp3[1];
    const r0 = L.collarR * 1.25;
    const r1 = L.plateR * 0.95;
    const sy = L.sinE;
    ctx.beginPath();
    ctx.moveTo(x0 - r1, y0);
    ctx.lineTo(x0 - r0, y0);
    ctx.moveTo(x0 + r0, y0);
    ctx.lineTo(x0 + r1, y0);
    ctx.moveTo(x0, y0 + r0 * sy);
    ctx.lineTo(x0, y0 + r1 * sy);
    // Fine ticks along the horizontal axis.
    for (let i = -3; i <= 3; i++) {
        if (i === 0) continue;
        const x = x0 + (i / 3.5) * r1;
        if (Math.abs(x - x0) < r0) continue;
        const t = Math.abs(i) === 3 ? 2.5 : 1.5;
        ctx.moveTo(x, y0 - t);
        ctx.lineTo(x, y0 + t);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
}

/** Thin force arrow on the ground from the collar in the push direction. */
function drawForceArrow(ctx: CanvasRenderingContext2D, st: TrackpointState, L: NubLayout, theme: PointingVizTheme, alpha: number): void {
    const m = Math.min(1, Math.hypot(st.fx, st.fy));
    if (alpha <= 0.002 || m < 0.03) return;
    const ux = st.fx / m;
    const uz = st.fy / m;
    const start = L.collarR * 1.15;
    const end = start + m * (L.plateR * 1.05 - start);
    projectPoint(L, ux * start, 0, uz * start, tmp3, 0);
    projectPoint(L, ux * end, 0, uz * end, tmp3b, 0);
    const x0 = tmp3[0], y0 = tmp3[1], x1 = tmp3b[0], y1 = tmp3b[1];
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 1) return;
    const dx = (x1 - x0) / len, dy = (y1 - y0) / len;
    const precise = st.mode === "precision";
    const lw = precise ? 1 : Math.max(1.2, L.s * (0.014 + 0.012 * m));
    const head = Math.min(len * 0.6, Math.max(3, L.s * (precise ? 0.045 : 0.06)));
    ctx.globalAlpha = alpha * (0.45 + 0.45 * m);
    ctx.strokeStyle = theme.accent;
    ctx.fillStyle = theme.accent;
    ctx.lineWidth = lw;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1 - dx * head * 0.7, y1 - dy * head * 0.7);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - dx * head - dy * head * 0.5, y1 - dy * head + dx * head * 0.5);
    ctx.lineTo(x1 - dx * head + dy * head * 0.5, y1 - dy * head - dx * head * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
}

function drawCollar(ctx: CanvasRenderingContext2D, L: NubLayout, pal: NubPalette): void {
    projectPoint(L, 0, 0, 0, tmp3, 0);
    const xb = tmp3[0], yb = tmp3[1], kb = tmp3[2];
    projectPoint(L, 0, L.collarH, 0, tmp3, 0);
    const xt = tmp3[0], yt = tmp3[1], kt = tmp3[2];
    const rb = L.collarR * kb, rt = L.collarTopR * kt;
    // Side: lower half of the foot, up the flanks, upper half of the top.
    ctx.beginPath();
    ctx.ellipse(xb, yb, rb, rb * L.sinE, 0, 0, Math.PI);
    ctx.lineTo(xt - rt, yt);
    ctx.ellipse(xt, yt, rt, rt * L.sinE, 0, Math.PI, Math.PI * 2);
    ctx.closePath();
    const side = ctx.createLinearGradient(xb - rb, 0, xb + rb, 0);
    side.addColorStop(0, pal.collar);
    side.addColorStop(0.28, pal.collarLit);
    side.addColorStop(0.62, pal.collar);
    side.addColorStop(1, pal.collarShade);
    ctx.fillStyle = side;
    ctx.fill();
    if (pal.dark) {
        ctx.strokeStyle = pal.rim;
        ctx.lineWidth = 1;
        ctx.stroke();
    }
    // Top face, lit from the upper left.
    ctx.beginPath();
    ctx.ellipse(xt, yt, rt, rt * L.sinE, 0, 0, Math.PI * 2);
    const top = ctx.createLinearGradient(xt - rt, yt - rt * L.sinE, xt + rt, yt + rt * L.sinE);
    top.addColorStop(0, pal.collarLit);
    top.addColorStop(1, pal.collarTop);
    ctx.fillStyle = top;
    ctx.fill();
}

/** Projects the spine and builds its screen normals/radii/lighting. */
function prepareStalk(L: NubLayout, pose: SpinePose, squish: number): void {
    const n = SPINE_SEGMENTS;
    const p = pose.pts;
    for (let i = 0; i <= n; i++) projectPoint(L, p[i * 3], p[i * 3 + 1], p[i * 3 + 2], spineScreen, i * 3);
    for (let i = 0; i <= n; i++) {
        const a = Math.max(0, i - 1);
        const b = Math.min(n, i + 1);
        let tx = spineScreen[b * 3] - spineScreen[a * 3];
        let ty = spineScreen[b * 3 + 1] - spineScreen[a * 3 + 1];
        const tl = Math.hypot(tx, ty);
        if (tl > 1e-9) {
            tx /= tl;
            ty /= tl;
        } else {
            tx = 0;
            ty = -1;
        }
        // Normal pointing to the stalk's right as it rises.
        spineNx[i] = -ty;
        spineNy[i] = tx;
        const t = i / n;
        // Squished: it bulges in the middle; stretched (negative): it thins.
        const bulge = 1 + squish * (squish > 0 ? 0.75 : 0.35) * Math.sin(Math.PI * Math.min(1, t * 1.1));
        spineR[i] = (L.stalkR0 + (L.stalkR1 - L.stalkR0) * t) * Math.max(0.5, bulge) * spineScreen[i * 3 + 2];
        spineLit[i] = spineNx[i] * LIGHT_X + spineNy[i] * LIGHT_Y;
    }
}

function stalkOutline(ctx: CanvasRenderingContext2D): void {
    const n = SPINE_SEGMENTS;
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
        const x = spineScreen[i * 3] + spineNx[i] * spineR[i];
        const y = spineScreen[i * 3 + 1] + spineNy[i] * spineR[i];
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    for (let i = n; i >= 0; i--) ctx.lineTo(spineScreen[i * 3] - spineNx[i] * spineR[i], spineScreen[i * 3 + 1] - spineNy[i] * spineR[i]);
    ctx.closePath();
}

/** A curve along the stalk offset by `f` radii toward the light (negative = away). */
function stalkOffsetCurve(ctx: CanvasRenderingContext2D, f: number, from: number): void {
    const n = SPINE_SEGMENTS;
    ctx.beginPath();
    for (let i = from; i <= n; i++) {
        const o = spineLit[i] * f * spineR[i];
        const x = spineScreen[i * 3] + spineNx[i] * o;
        const y = spineScreen[i * 3 + 1] + spineNy[i] * o;
        if (i === from) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
}

function drawStalk(ctx: CanvasRenderingContext2D, L: NubLayout, pal: NubPalette): void {
    const n = SPINE_SEGMENTS;
    const rMid = spineR[n >> 1];
    stalkOutline(ctx);
    // Darker near the collar (ambient occlusion), lighter toward the cap.
    const fill = ctx.createLinearGradient(spineScreen[0], spineScreen[1], spineScreen[n * 3], spineScreen[n * 3 + 1]);
    fill.addColorStop(0, pal.rubberShade);
    fill.addColorStop(0.22, pal.rubber);
    fill.addColorStop(1, pal.rubber);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // Edge darkening on both sides (the tube turns away from us).
    stalkOutline(ctx);
    ctx.strokeStyle = "rgba(40,0,0,0.35)";
    ctx.lineWidth = rMid * 0.75;
    ctx.stroke();
    // Shadow side, away from the light.
    stalkOffsetCurve(ctx, -0.75, 0);
    ctx.strokeStyle = "rgba(30,0,0,0.25)";
    ctx.lineWidth = rMid * 0.7;
    ctx.stroke();
    // Broad dull sheen on the lit side, then a narrower, slightly brighter core.
    stalkOffsetCurve(ctx, 0.42, 1);
    ctx.strokeStyle = pal.rubberLit;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = rMid * 0.8;
    ctx.stroke();
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = rMid * 0.35;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.restore();
    if (pal.dark) {
        stalkOutline(ctx);
        ctx.strokeStyle = pal.rim;
        ctx.lineWidth = 0.75;
        ctx.stroke();
    }
    // A small rubber boot where the stalk meets the collar.
    projectPoint(L, 0, L.collarH, 0, tmp3, 0);
    const br = L.stalkR0 * 1.45 * tmp3[2];
    ctx.beginPath();
    ctx.ellipse(tmp3[0], tmp3[1], br, br * L.sinE, 0, 0, Math.PI * 2);
    ctx.fillStyle = pal.rubberShade;
    ctx.fill();
}

const capFrameScratch = new Float64Array(9);

/**
 * The cap's frame for a stalk tipped by `angle` toward ground direction (dirX, dirZ):
 * [axis, e1, e2] (9 numbers). It is the minimal rotation that tilts the vertical onto
 * the tip tangent (Rodrigues, about k = up × dir) applied to world (y, x, z), so the
 * cap never twists about its own axis: at angle 0 it is the world frame whatever
 * the direction, and the frame changes continuously as the bend swings through zero.
 */
export function capFrame(dirX: number, dirZ: number, angle: number, out: Float64Array): Float64Array {
    const sa = Math.sin(angle), ca = Math.cos(angle), oc = 1 - ca;
    const kx = dirZ, kz = -dirX;
    // Axis: up' = up cos + (k × up) sin = (dirX sin, cos, dirZ sin).
    out[0] = dirX * sa;
    out[1] = ca;
    out[2] = dirZ * sa;
    // v' = v cos + (k × v) sin + k (k · v)(1 - cos), for v = x and v = z.
    out[3] = ca + kx * kx * oc;
    out[4] = kz * sa;
    out[5] = kz * kx * oc;
    out[6] = kx * kz * oc;
    out[7] = -kx * sa;
    out[8] = ca + kz * kz * oc;
    return out;
}

/**
 * The cap: a short rounded cylinder on the stalk's tip, its axis along the tip
 * tangent. Its silhouette is the convex hull of four rings (a rounded profile);
 * then the top face, lighter, with a ring of dimples.
 */
function drawCap(ctx: CanvasRenderingContext2D, L: NubLayout, pose: SpinePose, pal: NubPalette, squish: number): void {
    const n = SPINE_SEGMENTS;
    const p = pose.pts;
    const bx = p[n * 3], byw = p[n * 3 + 1], bz = p[n * 3 + 2];
    const phi = pose.angle;
    const f = capFrame(pose.dirX, pose.dirZ, phi, capFrameScratch);
    const ax = f[0], ay = f[1], az = f[2];
    const e1x = f[3], e1y = f[4], e1z = f[5];
    const e2x = f[6], e2y = f[7], e2z = f[8];
    const capH = L.capH * (1 - 0.5 * squish);
    const capR = L.capR * (1 + 0.28 * squish);
    // Ring heights (fraction of capH, below the tip a little so the cap sits over it) and radii.
    for (let ring = 0; ring < CAP_RINGS; ring++) {
        const h = ring === 0 ? -0.15 : ring === 1 ? 0.18 : ring === 2 ? 0.7 : 1;
        const r = ring === 0 ? 0.78 : ring === 1 ? 1 : ring === 2 ? 1 : 0.84;
        const cx = bx + ax * capH * h, cy = byw + ay * capH * h, cz = bz + az * capH * h;
        for (let j = 0; j < RING_POINTS; j++) {
            const u = ringCos[j] * capR * r, v = ringSin[j] * capR * r;
            projectPoint(L, cx + e1x * u + e2x * v, cy + e1y * u + e2y * v, cz + e1z * u + e2z * v, capRing, (ring * RING_POINTS + j) * 3);
        }
    }
    // Convex silhouette: the support point of all rings in each of HULL_DIRECTIONS.
    const total = CAP_RINGS * RING_POINTS;
    ctx.beginPath();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let d = 0; d < HULL_DIRECTIONS; d++) {
        let best = -Infinity, bi = 0;
        for (let i = 0; i < total; i++) {
            const v = capRing[i * 3] * hullCos[d] + capRing[i * 3 + 1] * hullSin[d];
            if (v > best) {
                best = v;
                bi = i;
            }
        }
        const x = capRing[bi * 3], y = capRing[bi * 3 + 1];
        if (d === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }
    ctx.closePath();
    // Side shading: lit from the left, dark on the right and underneath.
    const side = ctx.createLinearGradient(minX, minY, maxX, maxY);
    side.addColorStop(0, pal.rubberLit);
    side.addColorStop(0.35, pal.rubber);
    side.addColorStop(1, pal.rubberShade);
    ctx.fillStyle = side;
    ctx.fill();
    if (pal.dark) {
        ctx.strokeStyle = pal.rim;
        ctx.lineWidth = 0.75;
        ctx.stroke();
    }

    // Top face (ring 3).
    const top = 3 * RING_POINTS;
    ctx.beginPath();
    for (let j = 0; j < RING_POINTS; j++) {
        const i = (top + j) * 3;
        if (j === 0) ctx.moveTo(capRing[i], capRing[i + 1]);
        else ctx.lineTo(capRing[i], capRing[i + 1]);
    }
    ctx.closePath();
    const tcx = bx + ax * capH, tcy = byw + ay * capH, tcz = bz + az * capH;
    projectPoint(L, tcx, tcy, tcz, tmp3, 0);
    const sx = tmp3[0], sy = tmp3[1], k = tmp3[2];
    const rr = capR * 0.84 * k;
    const face = ctx.createRadialGradient(sx - rr * 0.35, sy - rr * 0.3, rr * 0.05, sx, sy, rr * 1.15);
    face.addColorStop(0, pal.capTopLit);
    face.addColorStop(0.6, pal.capTop);
    face.addColorStop(1, pal.rubber);
    ctx.fillStyle = face;
    ctx.fill();
    // Rounded rim catching the light.
    ctx.strokeStyle = "rgba(255,255,255,0.2)";
    ctx.lineWidth = Math.max(0.75, rr * 0.12);
    ctx.stroke();

    // Dimples: projected tiny discs on the top face.
    projectPoint(L, tcx + e1x * capR, tcy + e1y * capR, tcz + e1z * capR, tmp3b, 0);
    const v1x = tmp3b[0] - sx, v1y = tmp3b[1] - sy;
    projectPoint(L, tcx + e2x * capR, tcy + e2y * capR, tcz + e2z * capR, tmp3b, 0);
    const v2x = tmp3b[0] - sx, v2y = tmp3b[1] - sy;
    const l1 = Math.hypot(v1x, v1y), l2 = Math.hypot(v2x, v2y);
    const rot = Math.atan2(v1y, v1x);
    const dr = Math.max(0.45, capR * 0.085 * k);
    const squashRatio = l1 > 1e-6 ? Math.max(0.15, Math.min(1, l2 / l1)) : 1;
    ctx.fillStyle = pal.dimple;
    ctx.beginPath();
    for (let d = 0; d < DIMPLES.length; d += 2) {
        const u = DIMPLES[d] * 0.84, v = DIMPLES[d + 1] * 0.84;
        const x = sx + v1x * u + v2x * v;
        const y = sy + v1y * u + v2y * v;
        ctx.moveTo(x + dr * Math.cos(rot), y + dr * Math.sin(rot));
        ctx.ellipse(x, y, dr, dr * squashRatio, rot, 0, Math.PI * 2);
    }
    ctx.fill();
}

/** Wind streaks: perpendicular offsets (-1..1) and phase offsets, interleaved. */
const STREAKS = 6;
const STREAK_OFFSET = [-0.9, -0.5, -0.15, 0.2, 0.55, 0.9];
const STREAK_PHASE = [0.1, 0.62, 0.33, 0.85, 0.05, 0.5];

/** Wind streaks blowing past the nub in the push direction (boost). */
function drawStreaks(ctx: CanvasRenderingContext2D, st: TrackpointState, L: NubLayout, theme: PointingVizTheme, alpha: number, animated: boolean): void {
    const m = Math.min(1, Math.hypot(st.fx, st.fy));
    if (alpha <= 0.002 || m < 0.05) return;
    // Screen direction of the push (ground direction projected).
    projectPoint(L, 0, 0, 0, tmp3, 0);
    projectPoint(L, st.fx / m, 0, st.fy / m, tmp3b, 0);
    let dx = tmp3b[0] - tmp3[0], dy = tmp3b[1] - tmp3[1];
    const dl = Math.hypot(dx, dy) || 1;
    dx /= dl;
    dy /= dl;
    const px = -dy, py = dx;
    // Centre of the streak field: halfway up the upright stalk.
    projectPoint(L, 0, L.collarH + L.stalkL * 0.55, 0, tmp3, 0);
    const cx = tmp3[0], cy = tmp3[1];
    const span = L.s * 0.62;
    const len = L.s * (0.1 + 0.12 * m);
    ctx.strokeStyle = theme.accent;
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(1, L.s * 0.012);
    for (let i = 0; i < STREAKS; i++) {
        let u = (animated ? st.phase : 0.2) + STREAK_PHASE[i];
        u -= Math.floor(u);
        const off = STREAK_OFFSET[i] * L.s * 0.22;
        const along = (u - 0.5) * span;
        const x = cx + dx * along + px * off;
        const y = cy + dy * along + py * off;
        ctx.globalAlpha = alpha * Math.sin(Math.PI * u) * (0.25 + 0.45 * m);
        ctx.beginPath();
        ctx.moveTo(x - dx * len * 0.5, y - dy * len * 0.5);
        ctx.lineTo(x + dx * len * 0.5, y + dy * len * 0.5);
        ctx.stroke();
    }
    ctx.globalAlpha = 1;
}

/** Scroll: chevrons at both sides of the nub along the axis, the leading ones lit. */
function drawScrollChevrons(ctx: CanvasRenderingContext2D, st: TrackpointState, L: NubLayout, theme: PointingVizTheme, alpha: number, animated: boolean): void {
    if (alpha <= 0.002) return;
    const vertical = st.scrollAxis === "vertical";
    const m = Math.min(1, Math.hypot(st.fx, st.fy));
    const size = Math.max(2.5, L.s * 0.05);
    projectPoint(L, 0, L.collarH + L.stalkL * 0.5, 0, tmp3, 0);
    const midX = tmp3[0], midY = tmp3[1];
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = Math.max(1.2, L.s * 0.018);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const sides = vertical ? 2 : 1;
    for (let sideI = 0; sideI < sides; sideI++) {
        // Vertical: a column of two chevrons each side of the nub; horizontal: one each side.
        const colX = vertical ? midX + (sideI === 0 ? -1 : 1) * L.s * 0.42 : midX;
        for (let end = -1; end <= 1; end += 2) {
            for (let k = 0; k < 2; k++) {
                const lead = end === st.scrollSign;
                const pulse = lead && m > 0.02 ? 0.35 + 0.65 * Math.abs(Math.sin(((animated ? st.phase * 2 : 0.25) + k * 0.5) * Math.PI)) : 0.28;
                ctx.globalAlpha = alpha * pulse;
                const off = L.s * 0.1 + k * size * 0.75;
                ctx.beginPath();
                if (vertical) {
                    const y = midY + end * off;
                    ctx.moveTo(colX - size, y - end * size * 0.55);
                    ctx.lineTo(colX, y);
                    ctx.lineTo(colX + size, y - end * size * 0.55);
                } else {
                    const x = midX + end * (L.s * 0.36 + k * size * 0.75);
                    ctx.moveTo(x - end * size * 0.55, midY - size);
                    ctx.lineTo(x, midY);
                    ctx.lineTo(x - end * size * 0.55, midY + size);
                }
                ctx.stroke();
            }
        }
    }
    ctx.globalAlpha = 1;
}

/** Renders one frame. `animated` false = reduced-motion still frame. */
export function drawTrackpoint(
    ctx: CanvasRenderingContext2D,
    st: TrackpointState,
    theme: PointingVizTheme,
    width: number,
    height: number,
    now: number,
    animated: boolean,
): void {
    ctx.clearRect(0, 0, width, height);
    const L = nubLayout(width, height, layoutScratch);
    const pal = paletteFor(theme);
    const active = 1 - smoothstep(st.idle);
    const modeIn = animated ? smoothstep((now - st.modeSince) / MODE_FADE_MS) : 1;
    const decor = active * modeIn;
    const squish = Math.max(SQUISH_MIN, Math.min(SQUISH_MAX, st.squish));
    const pose = computeSpine(st.bx, st.by, L.collarH, L.stalkL * (1 - 0.38 * squish), spineScratch);
    const p = pose.pts;
    const tipX = p[SPINE_SEGMENTS * 3], tipZ = p[SPINE_SEGMENTS * 3 + 2];

    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Ground: plate, mode marks, shadows, force arrow.
    drawPlate(ctx, L, pal, theme, Math.max(0, Math.min(1, squish)));
    if (st.mode === "precision") drawReticle(ctx, L, theme, decor);
    const shadowA = pal.dark ? 0.5 : 0.32;
    // Cast shadow follows the bend (falls a little right and back, light from the upper left).
    const bend = Math.min(1.2, pose.angle / BEND_MAX_RAD);
    groundShadow(ctx, L, pal, tipX * 0.6 + L.s * 0.05, tipZ * 0.6 - L.s * 0.04, L.capR * (1.7 + 0.5 * bend), shadowA * (0.75 - 0.2 * bend));
    groundShadow(ctx, L, pal, L.s * 0.015, -L.s * 0.01, L.collarR * 1.45, shadowA);
    drawForceArrow(ctx, st, L, theme, decor);
    if (st.mode === "boost") drawStreaks(ctx, st, L, theme, decor, animated);

    // The nub.
    drawCollar(ctx, L, pal);
    prepareStalk(L, pose, squish);
    drawStalk(ctx, L, pal);
    drawCap(ctx, L, pose, pal, squish);
    // Ghost of the force arrow over the nub, so a push away from the viewer (arrow
    // behind the nub) still reads.
    if (st.fy < 0) drawForceArrow(ctx, st, L, theme, decor * 0.4 * Math.min(1, -st.fy / (Math.hypot(st.fx, st.fy) + 1e-9) * 1.5));

    if (st.mode === "scroll") drawScrollChevrons(ctx, st, L, theme, decor, animated);
    ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function nowMs(): number {
    return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function currentDpr(): number {
    return typeof window !== "undefined" && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
}

/** Re-renders when devicePixelRatio changes (zoom, moving to another monitor). */
function useDevicePixelRatio(): number {
    const [dpr, setDpr] = useState(currentDpr);
    useEffect(() => {
        if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
        let mql: MediaQueryList | null = null;
        const onChange = () => setDpr(currentDpr());
        try {
            mql = window.matchMedia(`(resolution: ${dpr}dppx)`);
            mql.addEventListener?.("change", onChange);
        } catch {
            mql = null;
        }
        return () => mql?.removeEventListener?.("change", onChange);
    }, [dpr]);
    return dpr;
}

const REDUCED_MOTION_MIN_MS = 250;

export function TrackpointViz(props: PointingVizProps): JSX.Element {
    const { source, side, width, height, reducedMotion, theme, className } = props;
    const wrapRef = useRef<HTMLDivElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const stateRef = useRef<TrackpointState | null>(null);
    if (stateRef.current === null) stateRef.current = createTrackpointState();
    const themeRef = useRef(theme);
    themeRef.current = theme;
    const redrawRef = useRef<() => void>(() => {});
    const dpr = useDevicePixelRatio();

    useEffect(() => {
        const st = stateRef.current as TrackpointState;
        const canvas = canvasRef.current;
        let ctx: CanvasRenderingContext2D | null = null;
        try {
            ctx = canvas ? setupPointingCanvas(canvas, width, height) : null;
        } catch {
            ctx = null;
        }
        let disposed = false;
        const draw = (now: number, animated: boolean) => {
            if (!ctx) return;
            try {
                drawTrackpoint(ctx, st, themeRef.current, width, height, now, animated);
            } catch {
                // A canvas failure must never take the layout down.
            }
        };

        if (reducedMotion) {
            // No loop: one static frame per sample (the bent pose for the latest
            // sample), at most every 250 ms (trailing).
            let lastDraw = -Infinity;
            let timer: ReturnType<typeof setTimeout> | undefined;
            const drawStatic = () => {
                timer = undefined;
                if (disposed) return;
                const now = nowMs();
                lastDraw = now;
                stepTrackpoint(st, source.latest(), now, 0, true);
                draw(now, false);
            };
            redrawRef.current = drawStatic;
            drawStatic();
            const unsubscribe = source.subscribe(() => {
                if (timer !== undefined) return;
                const wait = REDUCED_MOTION_MIN_MS - (nowMs() - lastDraw);
                if (wait <= 0) drawStatic();
                else timer = setTimeout(drawStatic, wait);
            });
            return () => {
                disposed = true;
                if (timer !== undefined) clearTimeout(timer);
                unsubscribe();
                redrawRef.current = () => {};
            };
        }

        let raf = 0;
        let running = false;
        let visible = true;
        let lastFrame = -1;
        const frame = (t: number) => {
            raf = 0;
            if (disposed) return;
            const now = Number.isFinite(t) && t > 0 ? t : nowMs();
            const dt = lastFrame < 0 ? 16 : now - lastFrame;
            lastFrame = now;
            stepTrackpoint(st, source.latest(), now, dt);
            draw(now, true);
            if (isTrackpointSettled(st, now)) {
                // The nub stands still on screen: sleep until a sample wakes us.
                running = false;
                lastFrame = -1;
                return;
            }
            raf = requestAnimationFrame(frame);
        };
        const start = () => {
            if (running || !visible || disposed) return;
            running = true;
            lastFrame = -1;
            raf = requestAnimationFrame(frame);
        };
        const stop = () => {
            if (raf) cancelAnimationFrame(raf);
            raf = 0;
            running = false;
            lastFrame = -1;
        };
        redrawRef.current = () => {
            if (running) return;
            draw(nowMs(), true);
        };

        const unsubscribe = source.subscribe((s) => {
            if (running) return;
            if (sampleHasMotion(s) || s.buttons !== 0 || samplePressure(s) > 0 || s.mode !== st.mode) start();
        });

        let observer: IntersectionObserver | null = null;
        if (typeof IntersectionObserver !== "undefined" && wrapRef.current) {
            try {
                observer = new IntersectionObserver((entries) => {
                    const entry = entries[entries.length - 1];
                    if (!entry) return;
                    visible = entry.isIntersecting;
                    if (visible) start();
                    else stop();
                });
                observer.observe(wrapRef.current);
            } catch {
                observer = null;
            }
        }

        start();
        return () => {
            disposed = true;
            stop();
            unsubscribe();
            observer?.disconnect();
            redrawRef.current = () => {};
        };
    }, [source, reducedMotion, width, height, dpr]);

    // Theme switch (light/dark): repaint the current frame with the new colours.
    useEffect(() => {
        redrawRef.current();
    }, [theme.foreground, theme.muted, theme.accent, theme.border]);

    const label = `${side === "left" ? "Left" : "Right"} trackpoint`;
    return (
        <div ref={wrapRef} role="img" aria-label={label} className={className} style={{ width, height, position: "relative" }}>
            <canvas ref={canvasRef} aria-hidden="true" style={{ display: "block", width, height }} />
        </div>
    );
}

/** Pure helpers and tunables, exported for unit tests and the render harness. */
export const _testTrackpoint = {
    SPRING_K,
    PUSH_ZETA,
    SWAY_ZETA,
    MODE_GAIN,
    BEND_MAX_RAD,
    BEND_LIMIT_RAD,
    PRESS_HOLD_MS,
    SQUISH_K,
    SQUISH_ZETA,
    samplePressure,
    squishTargetFor,
    springSquish,
    SPINE_SEGMENTS,
    createState: createTrackpointState,
    step: stepTrackpoint,
    isSettled: isTrackpointSettled,
    springBend,
    bendAngle,
    sampleRate,
    scrollAxisFor,
    nubLayout,
    createNubLayout,
    projectPoint,
    computeSpine,
    createSpinePose,
    capFrame,
    colorLightness,
    paletteFor,
    draw: drawTrackpoint,
};
