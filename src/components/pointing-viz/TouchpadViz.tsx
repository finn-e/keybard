// Touchpad visualization: a dark glass touchpad (rounded rect, about 1.15:1, like the
// near-square Azoteq pad) with glowing finger contacts. Touch positions are used when
// the firmware reports them; otherwise relative deltas are integrated into a wandering
// point that drifts back to the centre, and quickly so when idle. See
// docs/pointing-fragments-spec.md (C5, D).
//
// The glass: a soft drop shadow, a top-to-bottom gradient, a bright bevel on the upper
// edge and a darker lower edge, a faint diagonal sheen band and a faint etched grid.
// Contacts are accent glows (halo + core + white hot centre) drawn with 'lighter'
// over the glass, trailing tapered light streaks.
//
// Modes: pointer = one contact + 600 ms streak; scroll = two contacts with parallel
// streaks and chevrons streaming ahead of the pair along the scroll axis; precision =
// smaller, sharper contact under a fine etched crosshair; boost = bigger glow, 1200 ms
// streak. A button press sends a ripple ring through the glass from the contact and
// lights the rim; a held button rings the contact. Idle = the glass alone.
//
// All animation state lives in a ref; the canvas is redrawn from requestAnimationFrame
// and the loop stops when idle, when off-screen, and on unmount.

import { useEffect, useRef, type JSX } from "react";
import {
    POINTING_IDLE_MS,
    POINTING_SMOOTHING_MS,
    normalizeSpeed,
    setupPointingCanvas,
    type PointingLiveSample,
    type PointingMode,
    type PointingVizProps,
    type PointingVizTheme,
} from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Pad aspect, width / height (the real pad is close to square). */
const PAD_ASPECT = 1.15;
/** Integrated raw counts that move the wandering dot across the full pad width. */
const COUNTS_PER_PAD = 2400;
/** The dot centre never goes closer to the pad edge than this (pad units). */
const EDGE_MARGIN = 0.1;
/** Gap between the two scroll fingers (pad units, perpendicular to the scroll axis). */
const FINGER_GAP = 0.2;
/** Wheel unit to raw-count equivalent, for scroll speed from h/v. */
const WHEEL_TO_COUNTS = 8;
/** Driver wheel output keeps the scroll look for this long after the last h/v. */
const WHEEL_HOLD_MS = 300;
/** Ease into / out of idle. */
const IDLE_EASE_MS = 400;
/** Wandering dot drifts back to centre with this time constant (active / idle). */
const RECENTER_ACTIVE_MS = 2500;
const RECENTER_IDLE_MS = 450;
/** Drawn dots follow their target with this time constant (touch positions). */
const DOT_FOLLOW_MS = 45;
/** A touch jumping further than this in one sample is a new touch: no trail streak. */
const TOUCH_JUMP = 0.35;
/** Trail lengths. */
const TRAIL_MS = 600;
const TRAIL_BOOST_MS = 1200;
/** Ring buffer capacity per finger and the minimum time between trail points. */
const TRAIL_CAP = 160;
const TRAIL_MIN_STEP_MS = 9;
/** Button feedback: rim flash, and the ripple ring spreading through the glass. */
const FLASH_MS = 160;
const PULSE_MS = 650;
/** Reduced motion: at most one static frame per this many ms. */
const STATIC_FRAME_MS = 250;
/** Chevron travel speed at full magnitude, chevron spacings per ms. */
const CHEVRON_SPEED = 0.0036;
/** Grid etched in the glass (cells across x down). */
const GRID_COLS = 5;
const GRID_ROWS = 4;

const MAX_FINGERS = 2;

type ScrollAxis = "vertical" | "horizontal";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface TouchpadTrail {
    xs: Float32Array;
    ys: Float32Array;
    ts: Float64Array;
    /** Index of the next write. */
    head: number;
    count: number;
}

export interface TouchpadState {
    /** `t` of the last ingested sample (samples are ingested once). */
    lastSampleT: number;
    /** dtMs of the last ingested sample. */
    lastSampleDt: number;
    /** Frame time of the last sample that carried motion, touches or buttons. */
    lastActiveT: number;
    /** 0 = idle, 1 = fully active (eased over IDLE_EASE_MS). */
    activity: number;
    /** Raw rate of the latest sample (counts/ms), the smoothing target. */
    targetRateX: number;
    targetRateY: number;
    /** Signed scroll rate along the axis, in drawn direction (+ = down/right). */
    targetScrollRate: number;
    /** Smoothed rates. */
    rateX: number;
    rateY: number;
    scrollRate: number;
    /** 0..1 visual magnitude of the smoothed motion. */
    magnitude: number;
    saturated: boolean;
    /** Integrated wandering position, pad units 0..1. */
    ix: number;
    iy: number;
    /** True while the latest sample carried touch positions. */
    hasTouch: boolean;
    /** Drawn finger count: 1 or 2. */
    fingers: number;
    targetX: Float32Array;
    targetY: Float32Array;
    dotX: Float32Array;
    dotY: Float32Array;
    /** The dots have a position (false until the first sample). */
    placed: boolean;
    mode: PointingMode;
    axis: ScrollAxis;
    /** Driver-produced wheel motion holds the scroll look until this time. */
    wheelUntil: number;
    /** 0..1 chevron phase along the lane. */
    scrollPhase: number;
    prevButtons: number;
    /** Frame time of the last button press (flash + pulse). */
    pressT: number;
    trails: TouchpadTrail[];
    lastTrailT: number;
}

function createTrail(): TouchpadTrail {
    return {
        xs: new Float32Array(TRAIL_CAP),
        ys: new Float32Array(TRAIL_CAP),
        ts: new Float64Array(TRAIL_CAP),
        head: 0,
        count: 0,
    };
}

export function createTouchpadState(): TouchpadState {
    const trails: TouchpadTrail[] = [];
    for (let i = 0; i < MAX_FINGERS; i++) trails.push(createTrail());
    return {
        lastSampleT: Number.NEGATIVE_INFINITY,
        lastSampleDt: 33,
        lastActiveT: Number.NEGATIVE_INFINITY,
        activity: 0,
        targetRateX: 0,
        targetRateY: 0,
        targetScrollRate: 0,
        rateX: 0,
        rateY: 0,
        scrollRate: 0,
        magnitude: 0,
        saturated: false,
        ix: 0.5,
        iy: 0.5,
        hasTouch: false,
        fingers: 1,
        targetX: new Float32Array([0.5, 0.5]),
        targetY: new Float32Array([0.5, 0.5]),
        dotX: new Float32Array([0.5, 0.5]),
        dotY: new Float32Array([0.5, 0.5]),
        placed: false,
        mode: "pointer",
        axis: "vertical",
        wheelUntil: Number.NEGATIVE_INFINITY,
        scrollPhase: 0,
        prevButtons: 0,
        pressT: Number.NEGATIVE_INFINITY,
        trails,
        lastTrailT: Number.NEGATIVE_INFINITY,
    };
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
    return v < lo ? lo : v > hi ? hi : v;
}

/** True when a sample shows the hand doing something (motion, wheel, touch or click). */
export function isActiveSample(s: PointingLiveSample | null): boolean {
    if (!s) return false;
    return s.dx !== 0 || s.dy !== 0 || s.h !== 0 || s.v !== 0 || s.buttons !== 0 || (s.touches?.length ?? 0) > 0;
}

/** Scroll axis for a sample (spec D): the lock wins; otherwise the dominant axis, else `prev`. */
export function scrollAxisFor(s: PointingLiveSample, prev: ScrollAxis): ScrollAxis {
    if (s.axisLock === "horizontal") return "horizontal";
    if (s.axisLock === "vertical") return "vertical";
    const ah = Math.abs(s.h);
    const av = Math.abs(s.v);
    if (ah !== av) return ah > av ? "horizontal" : "vertical";
    const ax = Math.abs(s.dx);
    const ay = Math.abs(s.dy);
    if (ax !== ay) return ax > ay ? "horizontal" : "vertical";
    return prev;
}

/**
 * Signed scroll rate along `axis` in counts/ms, in drawn direction (+ = down/right).
 * Uses driver wheel units when present, else the raw motion. naturalScroll flips it.
 */
export function scrollRateFor(s: PointingLiveSample, axis: ScrollAxis): number {
    const dt = Math.max(1, s.dtMs);
    let r: number;
    if (axis === "vertical") r = s.v !== 0 ? (-s.v * WHEEL_TO_COUNTS) / dt : s.dy / dt;
    else r = s.h !== 0 ? (s.h * WHEEL_TO_COUNTS) / dt : s.dx / dt;
    return s.naturalScroll ? -r : r;
}

/** Maps a 0..1 touch coordinate into the drawable band, so an edge touch stays visible. */
export function touchToPad(v: number): number {
    return EDGE_MARGIN + clamp(v, 0, 1) * (1 - 2 * EDGE_MARGIN);
}

/**
 * Where the dots should be (pad units). With touches, they are used directly (a second
 * finger is placed beside the first when only one position is known). Without touches,
 * finger 0 is the wandering point (ix, iy). The second finger sits FINGER_GAP away
 * perpendicular to the scroll axis, and the pair is shifted to stay on the pad.
 */
export function fingerTargets(
    state: Pick<TouchpadState, "ix" | "iy" | "axis">,
    touches: readonly { x: number; y: number }[] | undefined,
    fingers: number,
    outX: Float32Array,
    outY: Float32Array,
): void {
    const lo = EDGE_MARGIN;
    const hi = 1 - EDGE_MARGIN;
    if (touches && touches.length >= 2 && fingers >= 2) {
        outX[0] = touchToPad(touches[0].x);
        outY[0] = touchToPad(touches[0].y);
        outX[1] = touchToPad(touches[1].x);
        outY[1] = touchToPad(touches[1].y);
        return;
    }
    let x0 = touches && touches.length > 0 ? touchToPad(touches[0].x) : state.ix;
    let y0 = touches && touches.length > 0 ? touchToPad(touches[0].y) : state.iy;
    if (fingers < 2) {
        outX[0] = outX[1] = x0;
        outY[0] = outY[1] = y0;
        return;
    }
    const gx = state.axis === "vertical" ? FINGER_GAP : 0;
    const gy = state.axis === "vertical" ? 0 : FINGER_GAP;
    // Centre the pair on the known point, then shift it back onto the pad.
    x0 -= gx / 2;
    y0 -= gy / 2;
    x0 = clamp(x0, lo, hi - gx);
    y0 = clamp(y0, lo, hi - gy);
    outX[0] = x0;
    outY[0] = y0;
    outX[1] = x0 + gx;
    outY[1] = y0 + gy;
}

/** Appends a point to a trail ring buffer (no allocation). */
export function trailPush(trail: TouchpadTrail, x: number, y: number, t: number): void {
    trail.xs[trail.head] = x;
    trail.ys[trail.head] = y;
    trail.ts[trail.head] = t;
    trail.head = (trail.head + 1) % TRAIL_CAP;
    if (trail.count < TRAIL_CAP) trail.count++;
}

export function trailClear(trail: TouchpadTrail): void {
    trail.count = 0;
}

/** Index of the i-th oldest stored point (0 = oldest). */
function trailIndex(trail: TouchpadTrail, i: number): number {
    return (trail.head - trail.count + i + TRAIL_CAP) % TRAIL_CAP;
}

/** Number of trail points younger than maxAgeMs at `now` (they are the newest ones). */
export function trailLiveCount(trail: TouchpadTrail, now: number, maxAgeMs: number): number {
    let n = 0;
    for (let i = trail.count - 1; i >= 0; i--) {
        if (now - trail.ts[trailIndex(trail, i)] > maxAgeMs) break;
        n++;
    }
    return n;
}

export function trailMsFor(mode: PointingMode): number {
    return mode === "boost" ? TRAIL_BOOST_MS : TRAIL_MS;
}

/** The drawn mode: scroll also while the driver itself produced wheel motion recently. */
function drawnMode(state: TouchpadState, now: number): PointingMode {
    return now < state.wheelUntil ? "scroll" : state.mode;
}

/**
 * Takes in one sample (once per distinct `t`). Integrates deltas into the wandering
 * point, sets smoothing targets, finger targets, axis, and button press time.
 * Returns true when the sample was new.
 */
export function ingestSample(state: TouchpadState, s: PointingLiveSample, now: number): boolean {
    if (s.t === state.lastSampleT) return false;
    state.lastSampleT = s.t;
    const dt = Math.max(1, s.dtMs);
    state.lastSampleDt = dt;

    // Activity is dated by the sample (performance.now() clock), so a stale sample
    // read at mount does not light the pad up.
    if (isActiveSample(s)) state.lastActiveT = Number.isFinite(s.t) ? Math.min(now, s.t) : now;
    state.mode = s.mode;
    state.saturated = s.saturated;
    if (s.h !== 0 || s.v !== 0) state.wheelUntil = now + WHEEL_HOLD_MS;
    const scrolling = s.mode === "scroll" || s.h !== 0 || s.v !== 0;
    if (scrolling) state.axis = scrollAxisFor(s, state.axis);

    state.targetRateX = s.dx / dt;
    state.targetRateY = s.dy / dt;
    state.targetScrollRate = scrolling ? scrollRateFor(s, state.axis) : 0;

    // Wander: precision moves the dot less, boost more (the pointer gain the user feels).
    const gain = s.mode === "precision" ? 0.5 : s.mode === "boost" ? 1.6 : 1;
    state.ix = clamp(state.ix + (s.dx * gain) / COUNTS_PER_PAD, EDGE_MARGIN, 1 - EDGE_MARGIN);
    state.iy = clamp(state.iy + (s.dy * gain * PAD_ASPECT) / COUNTS_PER_PAD, EDGE_MARGIN, 1 - EDGE_MARGIN);

    const touches = s.touches && s.touches.length > 0 ? s.touches : undefined;
    const prevFingers = state.fingers;
    state.fingers = s.fingers === 2 || (touches?.length ?? 0) >= 2 || scrolling ? 2 : 1;
    fingerTargets(state, touches, state.fingers, state.targetX, state.targetY);

    const newTouch = !!touches && !state.hasTouch;
    let jumped = false;
    if (touches && state.placed) {
        const ddx = state.targetX[0] - state.dotX[0];
        const ddy = state.targetY[0] - state.dotY[0];
        jumped = ddx * ddx + ddy * ddy > TOUCH_JUMP * TOUCH_JUMP;
    }
    state.hasTouch = !!touches;
    if (!state.placed || newTouch || jumped) {
        // Snap: a new touch-down starts its own trail rather than streaking across.
        for (let i = 0; i < MAX_FINGERS; i++) {
            state.dotX[i] = state.targetX[i];
            state.dotY[i] = state.targetY[i];
            trailClear(state.trails[i]);
        }
        state.placed = true;
    } else if (state.fingers === 2 && prevFingers !== 2) {
        state.dotX[1] = state.targetX[1];
        state.dotY[1] = state.targetY[1];
        trailClear(state.trails[1]);
    }

    const pressed = s.buttons & ~state.prevButtons;
    if (pressed !== 0) state.pressT = now;
    state.prevButtons = s.buttons;
    return true;
}

/**
 * Advances the animation by one frame of `frameDt` ms. Pure apart from mutating
 * `state`; allocates nothing.
 */
export function stepTouchpad(state: TouchpadState, sample: PointingLiveSample | null, now: number, frameDt: number): void {
    const dt = clamp(frameDt, 0, 100);
    if (sample) ingestSample(state, sample, now);

    // A sample older than a couple of windows means the hand stopped: rates go to zero.
    const fresh = sample !== null && now - state.lastActiveT <= Math.max(100, 2.5 * state.lastSampleDt);
    const tx = fresh ? state.targetRateX : 0;
    const ty = fresh ? state.targetRateY : 0;
    const ts = fresh ? state.targetScrollRate : 0;
    const k = 1 - Math.exp(-dt / POINTING_SMOOTHING_MS);
    state.rateX += (tx - state.rateX) * k;
    state.rateY += (ty - state.rateY) * k;
    state.scrollRate += (ts - state.scrollRate) * k;

    const mode = drawnMode(state, now);
    state.magnitude = state.saturated && fresh
        ? 1
        : mode === "scroll"
          ? normalizeSpeed(Math.max(Math.abs(state.scrollRate), Math.hypot(state.rateX, state.rateY)))
          : normalizeSpeed(Math.hypot(state.rateX, state.rateY));

    // Idle easing (linear over IDLE_EASE_MS).
    const activeTarget = now - state.lastActiveT <= POINTING_IDLE_MS ? 1 : 0;
    const stepA = dt / IDLE_EASE_MS;
    if (activeTarget > state.activity) state.activity = Math.min(1, state.activity + stepA);
    else if (activeTarget < state.activity) state.activity = Math.max(0, state.activity - stepA);

    // Wandering point drifts back to centre; fast once idle.
    if (!state.hasTouch) {
        const tau = activeTarget ? RECENTER_ACTIVE_MS : RECENTER_IDLE_MS;
        const kr = 1 - Math.exp(-dt / tau);
        state.ix += (0.5 - state.ix) * kr;
        state.iy += (0.5 - state.iy) * kr;
        fingerTargets(state, undefined, state.fingers, state.targetX, state.targetY);
    }

    // Dots follow their targets.
    const kf = 1 - Math.exp(-dt / DOT_FOLLOW_MS);
    for (let i = 0; i < MAX_FINGERS; i++) {
        state.dotX[i] += (state.targetX[i] - state.dotX[i]) * kf;
        state.dotY[i] += (state.targetY[i] - state.dotY[i]) * kf;
    }

    // Chevrons stream along the lane in the drawn scroll direction.
    if (mode === "scroll") {
        const dir = Math.sign(state.scrollRate);
        state.scrollPhase += dir * normalizeSpeed(Math.abs(state.scrollRate)) * CHEVRON_SPEED * dt;
        state.scrollPhase -= Math.floor(state.scrollPhase);
    }

    // Trails.
    if (state.activity > 0 && now - state.lastTrailT >= TRAIL_MIN_STEP_MS) {
        state.lastTrailT = now;
        trailPush(state.trails[0], state.dotX[0], state.dotY[0], now);
        if (state.fingers === 2) trailPush(state.trails[1], state.dotX[1], state.dotY[1], now);
    }
}

/**
 * Reduced motion: jump straight to the state a sample implies (no easing, no trails).
 */
export function snapTouchpad(state: TouchpadState, sample: PointingLiveSample | null, now: number): void {
    if (sample) ingestSample(state, sample, now);
    const active = sample !== null && now - state.lastActiveT <= POINTING_IDLE_MS;
    const fresh = sample !== null && now - state.lastActiveT <= Math.max(100, 2.5 * state.lastSampleDt);
    state.rateX = fresh ? state.targetRateX : 0;
    state.rateY = fresh ? state.targetRateY : 0;
    state.scrollRate = fresh ? state.targetScrollRate : 0;
    const mode = drawnMode(state, now);
    state.magnitude = state.saturated && fresh
        ? 1
        : normalizeSpeed(mode === "scroll" ? Math.abs(state.scrollRate) : Math.hypot(state.rateX, state.rateY));
    state.activity = active ? 1 : 0;
    if (!state.hasTouch) {
        // No integration path to show statically: the dot stays at the centre.
        state.ix = 0.5;
        state.iy = 0.5;
        fingerTargets(state, undefined, state.fingers, state.targetX, state.targetY);
    }
    for (let i = 0; i < MAX_FINGERS; i++) {
        state.dotX[i] = state.targetX[i];
        state.dotY[i] = state.targetY[i];
        trailClear(state.trails[i]);
    }
}

/** True while something is still moving and the loop must keep running. */
export function needsAnimation(state: TouchpadState, now: number): boolean {
    if (state.activity > 0) return true;
    if (now - state.pressT < PULSE_MS) return true;
    return now - state.lastActiveT <= POINTING_IDLE_MS;
}


export interface PadRect {
    x: number;
    y: number;
    w: number;
    h: number;
    r: number;
    /** Base contact core radius, CSS px. */
    dot: number;
}

/**
 * The pad rectangle (aspect PAD_ASPECT, near square like the TPS43) in the drawing area, CSS px: centred
 * across, with a little more room below than above for the slab's shadow.
 */
export function padRect(width: number, height: number): PadRect {
    // The pad fills the slot: on the board a TPS43 is the widest pointing module.
    const mx = Math.max(2, width * 0.015);
    const top = Math.max(2, height * 0.02);
    const bottom = Math.max(3, height * 0.05);
    const aw = Math.max(1, width - 2 * mx);
    const ah = Math.max(1, height - top - bottom);
    const w = Math.min(aw, ah * PAD_ASPECT);
    const h = w / PAD_ASPECT;
    const s = Math.min(w, h);
    return {
        x: (width - w) / 2,
        y: top + (ah - h) / 2,
        w,
        h,
        r: Math.max(3, s * 0.14),
        dot: Math.max(2.5, s * 0.075),
    };
}

/** Contact core radius for a mode at a magnitude. */
export function dotRadius(base: number, mode: PointingMode, magnitude: number): number {
    const m = mode === "precision" ? 0.62 : mode === "boost" ? 1.3 : 1;
    return base * m * (1 + 0.15 * clamp(magnitude, 0, 1));
}

/** How far a contact's glow reaches, as a multiple of its core radius. */
export function haloScale(mode: PointingMode, magnitude: number): number {
    const m = clamp(magnitude, 0, 1);
    if (mode === "precision") return 2.1;
    if (mode === "boost") return 3.6 + 1.2 * m;
    return 2.8 + 0.6 * m;
}

/**
 * Half-width of a streak at position u along it (0 = tail, 1 = head), as a fraction
 * of the full width: a smooth taper to a point at the tail.
 */
export function streakTaper(u: number): number {
    const v = clamp(u, 0, 1);
    return Math.sqrt(v) * (0.35 + 0.65 * v);
}

/**
 * The button ripple at `sinceMs` after a press: ring radius (CSS px) and its 0..1
 * strength, or strength 0 once it has spread out. `reach` is how far it travels.
 */
export function rippleAt(sinceMs: number, coreR: number, reach: number): { radius: number; strength: number } {
    if (sinceMs < 0 || sinceMs >= PULSE_MS) return { radius: coreR, strength: 0 };
    const p = sinceMs / PULSE_MS;
    // Fast out, slowing as it spreads (ease-out cubic).
    const e = 1 - (1 - p) * (1 - p) * (1 - p);
    return { radius: coreR * 1.1 + e * reach, strength: (1 - p) * (1 - p) };
}

/**
 * Positions of the scroll chevrons along the axis, in chevron spacings ahead of
 * the leading edge, for a 0..1 phase: `count` values in [0, count), each with a
 * fade that rises then falls so chevrons appear and vanish softly.
 */
export function chevronSlots(phase: number, count: number, out: Float32Array, fade: Float32Array): void {
    const p = phase - Math.floor(phase);
    for (let i = 0; i < count; i++) {
        const t = i + p;
        out[i] = t;
        fade[i] = Math.sin((Math.PI * t) / count);
    }
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

/** Glass colours are fixed: dark glass reads on both light and dark pages. */
const GLASS_TOP = "#2b3547";
const GLASS_BOTTOM = "#0f1521";
const TRANSPARENT = "rgba(0,0,0,0)";
const WHITE_0 = "rgba(255,255,255,0)";

const CHEVRON_COUNT = 3;
/** Streak points nearer than this (CSS px, Manhattan) are merged. */
const STREAK_MIN_STEP = 1.2;
/** Scratch buffers (no per-frame allocation). */
const streakX = new Float32Array(TRAIL_CAP);
const streakY = new Float32Array(TRAIL_CAP);
const chevPos = new Float32Array(CHEVRON_COUNT);
const chevFade = new Float32Array(CHEVRON_COUNT);

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
}

/** Slab, shadow, gradient, vignette and sheen (everything under the contacts). */
function drawGlass(ctx: CanvasRenderingContext2D, pad: PadRect, theme: PointingVizTheme, a: number): void {
    const s = Math.min(pad.w, pad.h);

    // Soft shadow under the slab, then the body.
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.38)";
    ctx.shadowBlur = Math.max(3, s * 0.11);
    ctx.shadowOffsetY = Math.max(1.5, s * 0.045);
    const body = ctx.createLinearGradient(0, pad.y, 0, pad.y + pad.h);
    body.addColorStop(0, GLASS_TOP);
    body.addColorStop(1, GLASS_BOTTOM);
    ctx.fillStyle = body;
    roundRectPath(ctx, pad.x, pad.y, pad.w, pad.h, pad.r);
    ctx.fill();
    ctx.restore();

    ctx.save();
    roundRectPath(ctx, pad.x, pad.y, pad.w, pad.h, pad.r);
    ctx.clip();

    // A whisper of the accent in the glass, a touch more while a finger is on it.
    ctx.fillStyle = theme.accent;
    ctx.globalAlpha = 0.07 + 0.05 * a;
    ctx.fillRect(pad.x, pad.y, pad.w, pad.h);
    ctx.globalAlpha = 1;

    // Depth: edges a little darker than the middle.
    const cx = pad.x + pad.w / 2;
    const cy = pad.y + pad.h / 2;
    const vig = ctx.createRadialGradient(cx, cy - pad.h * 0.1, s * 0.25, cx, cy, Math.hypot(pad.w, pad.h) * 0.6);
    vig.addColorStop(0, TRANSPARENT);
    vig.addColorStop(1, "rgba(0,0,0,0.35)");
    ctx.fillStyle = vig;
    ctx.fillRect(pad.x, pad.y, pad.w, pad.h);

    // Diagonal reflection band, upper left to lower right, plus a fainter echo.
    const sheen = ctx.createLinearGradient(pad.x, pad.y, pad.x + pad.w, pad.y + pad.h);
    sheen.addColorStop(0, "rgba(255,255,255,0.10)");
    sheen.addColorStop(0.2, "rgba(255,255,255,0.03)");
    sheen.addColorStop(0.3, WHITE_0);
    sheen.addColorStop(0.36, "rgba(255,255,255,0.09)");
    sheen.addColorStop(0.44, "rgba(255,255,255,0.025)");
    sheen.addColorStop(0.5, WHITE_0);
    sheen.addColorStop(0.53, "rgba(255,255,255,0.04)");
    sheen.addColorStop(0.57, WHITE_0);
    sheen.addColorStop(1, WHITE_0);
    ctx.fillStyle = sheen;
    ctx.fillRect(pad.x, pad.y, pad.w, pad.h);

    // Faint etched grid: a dark groove with a light lip below/right of it.
    const lw = 1;
    const fadeGrid = 1 - 0.45 * a;
    ctx.lineWidth = lw;
    for (let pass = 0; pass < 2; pass++) {
        ctx.strokeStyle = pass === 0 ? "rgba(0,0,0,0.22)" : "rgba(255,255,255,0.045)";
        ctx.globalAlpha = fadeGrid;
        const off = pass === 0 ? 0 : 1;
        ctx.beginPath();
        for (let i = 1; i < GRID_COLS; i++) {
            const x = Math.round(pad.x + (i / GRID_COLS) * pad.w) + 0.5 + off;
            ctx.moveTo(x, pad.y);
            ctx.lineTo(x, pad.y + pad.h);
        }
        for (let j = 1; j < GRID_ROWS; j++) {
            const y = Math.round(pad.y + (j / GRID_ROWS) * pad.h) + 0.5 + off;
            ctx.moveTo(pad.x, y);
            ctx.lineTo(pad.x + pad.w, y);
        }
        ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
}

/** Bevel and rim, drawn last so they sit over the glows. `flash` 0..1 lights the rim. */
function drawBevel(ctx: CanvasRenderingContext2D, pad: PadRect, theme: PointingVizTheme, flash: number): void {
    const s = Math.min(pad.w, pad.h);
    const bw = s > 80 ? 1.5 : 1;
    // Upper edge catches the light; the lower edge falls into shade.
    const bevel = ctx.createLinearGradient(0, pad.y, 0, pad.y + pad.h);
    bevel.addColorStop(0, "rgba(255,255,255,0.55)");
    bevel.addColorStop(0.14, "rgba(255,255,255,0.16)");
    bevel.addColorStop(0.45, WHITE_0);
    bevel.addColorStop(0.75, TRANSPARENT);
    bevel.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.strokeStyle = bevel;
    ctx.lineWidth = bw;
    const i = bw / 2 + 0.25;
    roundRectPath(ctx, pad.x + i, pad.y + i, pad.w - 2 * i, pad.h - 2 * i, pad.r - i);
    ctx.stroke();
    // Outer rim in the theme's border colour, so the slab has an edge on any page.
    ctx.strokeStyle = theme.border;
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 1;
    roundRectPath(ctx, pad.x - 0.5, pad.y - 0.5, pad.w + 1, pad.h + 1, pad.r + 0.5);
    ctx.stroke();
    if (flash > 0) {
        ctx.strokeStyle = theme.accent;
        ctx.globalAlpha = flash;
        ctx.lineWidth = s > 80 ? 2 : 1.5;
        ctx.stroke();
    }
    ctx.globalAlpha = 1;
}

/** One glowing contact: halo, accent core and a white hot centre (additive). */
function drawContact(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    r: number,
    halo: number,
    intensity: number,
    sharp: boolean,
    theme: PointingVizTheme,
): void {
    const R = r * halo;
    const g1 = ctx.createRadialGradient(x, y, 0, x, y, R);
    g1.addColorStop(0, theme.accent);
    g1.addColorStop(1, TRANSPARENT);
    ctx.fillStyle = g1;
    ctx.globalAlpha = 0.55 * intensity;
    ctx.beginPath();
    ctx.arc(x, y, R, 0, Math.PI * 2);
    ctx.fill();

    const cr = r * (sharp ? 1.15 : 1.45);
    const g2 = ctx.createRadialGradient(x, y, 0, x, y, cr);
    g2.addColorStop(0, theme.accent);
    g2.addColorStop(sharp ? 0.78 : 0.5, theme.accent);
    g2.addColorStop(1, TRANSPARENT);
    ctx.fillStyle = g2;
    ctx.globalAlpha = intensity;
    ctx.beginPath();
    ctx.arc(x, y, cr, 0, Math.PI * 2);
    ctx.fill();

    const hr = r * (sharp ? 0.6 : 0.8);
    const g3 = ctx.createRadialGradient(x, y, 0, x, y, hr);
    g3.addColorStop(0, "rgba(255,255,255,0.95)");
    g3.addColorStop(sharp ? 0.6 : 0.35, "rgba(255,255,255,0.55)");
    g3.addColorStop(1, WHITE_0);
    ctx.fillStyle = g3;
    ctx.globalAlpha = intensity;
    ctx.beginPath();
    ctx.arc(x, y, hr, 0, Math.PI * 2);
    ctx.fill();
}

/**
 * Fills a tapered streak through points (streakX/Y, n of them, tail first) with a
 * gradient from transparent at the tail to `color` at the head.
 */
function fillStreak(ctx: CanvasRenderingContext2D, n: number, width: number, color: string, alpha: number): void {
    if (n < 2) return;
    const tx = streakX[0];
    const ty = streakY[0];
    const hx = streakX[n - 1];
    const hy = streakY[n - 1];
    if (Math.abs(hx - tx) + Math.abs(hy - ty) < 0.5) return;
    // Left side forward, right side back.
    ctx.beginPath();
    for (let pass = 0; pass < 2; pass++) {
        const side = pass === 0 ? 1 : -1;
        for (let k = 0; k < n; k++) {
            const i = pass === 0 ? k : n - 1 - k;
            // Tangent over a few neighbours, so the edges stay smooth.
            const a = i > 1 ? i - 2 : 0;
            const b = i < n - 2 ? i + 2 : n - 1;
            let dx = streakX[b] - streakX[a];
            let dy = streakY[b] - streakY[a];
            const len = Math.hypot(dx, dy);
            if (len > 1e-6) {
                dx /= len;
                dy /= len;
            } else {
                dx = 1;
                dy = 0;
            }
            const hw = 0.5 * width * streakTaper(i / (n - 1));
            const px = streakX[i] - dy * hw * side;
            const py = streakY[i] + dx * hw * side;
            if (pass === 0 && k === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
    }
    ctx.closePath();
    const g = ctx.createLinearGradient(tx, ty, hx, hy);
    g.addColorStop(0, TRANSPARENT);
    g.addColorStop(1, color);
    ctx.fillStyle = g;
    ctx.globalAlpha = alpha;
    ctx.fill();
}

/** Loads a trail's live points (pixel coords) into the scratch buffers; returns the count. */
function loadStreak(trail: TouchpadTrail, pad: PadRect, now: number, maxAgeMs: number, headX: number, headY: number): number {
    const live = trailLiveCount(trail, now, maxAgeMs);
    let n = 0;
    for (let i = trail.count - live; i < trail.count && n < TRAIL_CAP - 1; i++) {
        const ci = trailIndex(trail, i);
        const x = pad.x + trail.xs[ci] * pad.w;
        const y = pad.y + trail.ys[ci] * pad.h;
        // Points closer than a pixel only make the outline ragged.
        if (n > 0 && Math.abs(x - streakX[n - 1]) + Math.abs(y - streakY[n - 1]) < STREAK_MIN_STEP) continue;
        streakX[n] = x;
        streakY[n] = y;
        n++;
    }
    // End exactly on the contact (replacing a last point that sits on top of it).
    if (n > 0 && Math.abs(headX - streakX[n - 1]) + Math.abs(headY - streakY[n - 1]) < STREAK_MIN_STEP) n--;
    streakX[n] = headX;
    streakY[n] = headY;
    return n + 1;
}

function drawChevron(ctx: CanvasRenderingContext2D, cx: number, cy: number, ux: number, uy: number, size: number): void {
    const nx = -uy;
    const ny = ux;
    ctx.beginPath();
    ctx.moveTo(cx - ux * size * 0.55 + nx * size, cy - uy * size * 0.55 + ny * size);
    ctx.lineTo(cx + ux * size * 0.45, cy + uy * size * 0.45);
    ctx.lineTo(cx - ux * size * 0.55 - nx * size, cy - uy * size * 0.55 - ny * size);
    ctx.stroke();
}

export interface DrawOptions {
    width: number;
    height: number;
    theme: PointingVizTheme;
    side: "left" | "right";
    reducedMotion: boolean;
}

export function drawTouchpad(ctx: CanvasRenderingContext2D, state: TouchpadState, now: number, o: DrawOptions): void {
    const { theme } = o;
    ctx.clearRect(0, 0, o.width, o.height);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    const pad = padRect(o.width, o.height);
    const s = Math.min(pad.w, pad.h);
    const a = state.activity;
    const mode = drawnMode(state, now);
    const sincePress = now - state.pressT;

    drawGlass(ctx, pad, theme, a);

    ctx.save();
    roundRectPath(ctx, pad.x, pad.y, pad.w, pad.h, pad.r);
    ctx.clip();

    const mag = state.magnitude;
    const r = dotRadius(pad.dot, mode, mag);
    const fingers = state.fingers;
    const d0x = pad.x + state.dotX[0] * pad.w;
    const d0y = pad.y + state.dotY[0] * pad.h;

    // Precision: a fine crosshair etched in the glass through the contact.
    if (a > 0.001 && mode === "precision") {
        const gap = r * 2.6;
        for (let pass = 0; pass < 2; pass++) {
            ctx.strokeStyle = pass === 0 ? "rgba(0,0,0,0.45)" : "rgba(255,255,255,0.4)";
            ctx.globalAlpha = a;
            ctx.lineWidth = 1;
            const off = pass === 0 ? 0.75 : 0;
            const x = Math.round(d0x) + 0.5 + off;
            const y = Math.round(d0y) + 0.5 + off;
            ctx.beginPath();
            ctx.moveTo(pad.x, y);
            ctx.lineTo(d0x - gap, y);
            ctx.moveTo(d0x + gap, y);
            ctx.lineTo(pad.x + pad.w, y);
            ctx.moveTo(x, pad.y);
            ctx.lineTo(x, d0y - gap);
            ctx.moveTo(x, d0y + gap);
            ctx.lineTo(x, pad.y + pad.h);
            ctx.stroke();
        }
        // Tick marks every eighth of the pad along both hairlines.
        ctx.strokeStyle = "rgba(255,255,255,0.28)";
        ctx.beginPath();
        const t = Math.max(1.5, s * 0.025);
        for (let i = 1; i < 8; i++) {
            const x = pad.x + (i / 8) * pad.w;
            const y = pad.y + (i / 8) * pad.h;
            if (Math.abs(x - d0x) > gap) {
                ctx.moveTo(x, d0y - t);
                ctx.lineTo(x, d0y + t);
            }
            if (Math.abs(y - d0y) > gap) {
                ctx.moveTo(d0x - t, y);
                ctx.lineTo(d0x + t, y);
            }
        }
        ctx.stroke();
    }

    // Everything that glows is added onto the glass.
    ctx.globalCompositeOperation = "lighter";

    if (a > 0.001) {
        const intensity = a * (0.8 + 0.2 * mag);

        // Light streaks behind the contacts.
        if (!o.reducedMotion) {
            const trailMs = trailMsFor(mode);
            const width = r * (mode === "precision" ? 1.3 : mode === "boost" ? 1.9 : 1.6);
            for (let f = 0; f < fingers; f++) {
                const n = loadStreak(state.trails[f], pad, now, trailMs, pad.x + state.dotX[f] * pad.w, pad.y + state.dotY[f] * pad.h);
                fillStreak(ctx, n, width, theme.accent, a * (mode === "boost" ? 0.95 : 0.7));
                fillStreak(ctx, n, width * 0.3, "rgba(255,255,255,0.8)", a * 0.55);
            }
        } else if (mode !== "scroll" && mag > 0.02) {
            // Reduced motion: a still streak behind the contact, against the motion.
            const len = Math.hypot(state.rateX, state.rateY);
            if (len > 0) {
                const l = r * 1.5 + mag * s * 0.35;
                streakX[0] = d0x - (state.rateX / len) * l;
                streakY[0] = d0y - (state.rateY / len) * l;
                streakX[1] = d0x;
                streakY[1] = d0y;
                const width = r * 1.6;
                fillStreak(ctx, 2, width, theme.accent, a * 0.7);
                fillStreak(ctx, 2, width * 0.3, "rgba(255,255,255,0.8)", a * 0.55);
            }
        }

        // Scroll: chevrons streaming ahead of the pair along the axis.
        if (mode === "scroll") {
            const vertical = state.axis === "vertical";
            const dir = state.scrollRate < 0 ? -1 : 1;
            const ux = vertical ? 0 : dir;
            const uy = vertical ? dir : 0;
            let mx = d0x;
            let my = d0y;
            if (fingers === 2) {
                mx = (d0x + pad.x + state.dotX[1] * pad.w) / 2;
                my = (d0y + pad.y + state.dotY[1] * pad.h) / 2;
            }
            const size = Math.max(2, s * 0.06);
            const spacing = size * 1.25;
            const lead = r * 2.1;
            chevronSlots(o.reducedMotion ? 0.5 : state.scrollPhase, CHEVRON_COUNT, chevPos, chevFade);
            ctx.strokeStyle = theme.accent;
            ctx.lineWidth = Math.max(1.2, s * 0.024);
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            const strength = a * (0.45 + 0.55 * normalizeSpeed(Math.abs(state.scrollRate)));
            for (let i = 0; i < CHEVRON_COUNT; i++) {
                const d = lead + chevPos[i] * spacing;
                ctx.globalAlpha = strength * chevFade[i];
                drawChevron(ctx, mx + ux * d, my + uy * d, ux, uy, size);
            }
        }

        // Contacts.
        const halo = haloScale(mode, mag);
        const sharp = mode === "precision";
        for (let f = 0; f < fingers; f++) {
            drawContact(ctx, pad.x + state.dotX[f] * pad.w, pad.y + state.dotY[f] * pad.h, r, halo, intensity, sharp, theme);
        }

        // A held button rings the contact.
        if (state.prevButtons !== 0) {
            ctx.strokeStyle = theme.accent;
            ctx.lineWidth = Math.max(1, r * 0.3);
            ctx.globalAlpha = a * 0.8;
            for (let f = 0; f < fingers; f++) {
                ctx.beginPath();
                ctx.arc(pad.x + state.dotX[f] * pad.w, pad.y + state.dotY[f] * pad.h, r * 1.9, 0, Math.PI * 2);
                ctx.stroke();
            }
        }
    }

    // Button press: a ripple through the glass from the contact, and a brief glow.
    if (!o.reducedMotion && sincePress >= 0 && sincePress < PULSE_MS) {
        const reach = Math.hypot(pad.w, pad.h) * 0.55;
        ctx.strokeStyle = theme.accent;
        for (let ring = 0; ring < 2; ring++) {
            const rp = rippleAt(sincePress - ring * PULSE_MS * 0.18, r, reach);
            if (rp.strength <= 0) continue;
            ctx.lineWidth = Math.max(1, r * (ring === 0 ? 0.55 : 0.35) * (0.4 + 0.6 * rp.strength));
            ctx.globalAlpha = rp.strength * (ring === 0 ? 0.9 : 0.5);
            for (let f = 0; f < fingers; f++) {
                ctx.beginPath();
                ctx.arc(pad.x + state.dotX[f] * pad.w, pad.y + state.dotY[f] * pad.h, rp.radius, 0, Math.PI * 2);
                ctx.stroke();
            }
        }
        const glow = 1 - sincePress / PULSE_MS;
        ctx.fillStyle = theme.accent;
        ctx.globalAlpha = 0.12 * glow * glow;
        ctx.fillRect(pad.x, pad.y, pad.w, pad.h);
    }

    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.restore();

    const flash = sincePress >= 0 && sincePress < FLASH_MS ? 1 - sincePress / FLASH_MS : 0;
    drawBevel(ctx, pad, theme, o.reducedMotion ? 0 : flash);
    ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function nowMs(): number {
    return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function sideLabel(side: "left" | "right"): string {
    return side === "left" ? "Left" : "Right";
}

export function TouchpadViz(props: PointingVizProps): JSX.Element {
    const { source, side, width, height, reducedMotion, theme, className } = props;
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const stateRef = useRef<TouchpadState | null>(null);
    if (stateRef.current === null) stateRef.current = createTouchpadState();
    // Theme and side are read per frame through a ref so a theme switch does not
    // restart the loop or lose the animation state.
    const drawRef = useRef<DrawOptions>({ width, height, theme, side, reducedMotion });
    drawRef.current = { width, height, theme, side, reducedMotion };

    useEffect(() => {
        const canvas = canvasRef.current;
        const state = stateRef.current;
        if (!canvas || !state) return;
        let ctx: CanvasRenderingContext2D | null = null;
        let dpr = 0;
        const ensureCanvas = () => {
            const cur = typeof window !== "undefined" && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
            if (cur !== dpr) {
                dpr = cur;
                try {
                    ctx = setupPointingCanvas(canvas, width, height);
                } catch {
                    ctx = null;
                }
            }
        };
        const paint = (now: number) => {
            ensureCanvas();
            if (!ctx) return;
            try {
                drawTouchpad(ctx, state, now, drawRef.current);
            } catch {
                // Never throw from a frame (e.g. a canvas implementation without arcTo).
            }
        };

        let disposed = false;

        if (reducedMotion) {
            let timer: ReturnType<typeof setTimeout> | undefined;
            let lastPaint = Number.NEGATIVE_INFINITY;
            const drawStatic = () => {
                timer = undefined;
                if (disposed) return;
                const now = nowMs();
                lastPaint = now;
                snapTouchpad(state, source.latest(), now);
                paint(now);
            };
            drawStatic();
            const unsubscribe = source.subscribe(() => {
                if (timer !== undefined || disposed) return;
                timer = setTimeout(drawStatic, Math.max(0, lastPaint + STATIC_FRAME_MS - nowMs()));
            });
            return () => {
                disposed = true;
                if (timer !== undefined) clearTimeout(timer);
                unsubscribe();
            };
        }

        const hasRaf = typeof requestAnimationFrame === "function";
        let raf = 0;
        let lastFrame = 0;
        let visible = true;

        const frame = (t: number) => {
            raf = 0;
            if (disposed) return;
            const now = typeof t === "number" && t > 0 ? t : nowMs();
            const dt = lastFrame > 0 ? now - lastFrame : 16;
            lastFrame = now;
            stepTouchpad(state, source.latest(), now, dt);
            paint(now);
            // Keep going while there is something to show; otherwise sleep until an
            // active sample arrives (one last frame above already drew the idle image).
            if (visible && needsAnimation(state, now)) raf = requestAnimationFrame(frame);
        };
        const wake = () => {
            if (disposed || raf !== 0 || !visible || !hasRaf) return;
            lastFrame = 0;
            raf = requestAnimationFrame(frame);
        };

        // Draw the idle image once, then start if the source is already active.
        const start = nowMs();
        stepTouchpad(state, source.latest(), start, 0);
        paint(start);
        if (needsAnimation(state, start)) wake();

        const unsubscribe = source.subscribe((s) => {
            if (raf === 0 && isActiveSample(s)) wake();
        });

        let observer: IntersectionObserver | null = null;
        if (typeof IntersectionObserver === "function") {
            observer = new IntersectionObserver((entries) => {
                const entry = entries[entries.length - 1];
                if (!entry) return;
                visible = entry.isIntersecting;
                if (visible) wake();
                else if (raf !== 0) {
                    cancelAnimationFrame(raf);
                    raf = 0;
                }
            });
            observer.observe(canvas);
        }

        return () => {
            disposed = true;
            if (raf !== 0 && typeof cancelAnimationFrame === "function") cancelAnimationFrame(raf);
            raf = 0;
            unsubscribe();
            observer?.disconnect();
        };
    }, [source, width, height, reducedMotion]);

    return (
        <div
            role="img"
            aria-label={`${sideLabel(side)} touchpad`}
            className={className}
            style={{ width, height, position: "relative" }}
        >
            <canvas ref={canvasRef} aria-hidden="true" style={{ display: "block", width, height }} />
        </div>
    );
}

// Test hooks (spec E: pure helpers exported with a _test prefix).
export const _testCreateState = createTouchpadState;
export const _testIngest = ingestSample;
export const _testStep = stepTouchpad;
export const _testSnap = snapTouchpad;
export const _testFingerTargets = fingerTargets;
export const _testScrollAxis = scrollAxisFor;
export const _testScrollRate = scrollRateFor;
export const _testTrailPush = trailPush;
export const _testTrailLiveCount = trailLiveCount;
export const _testTrailMs = trailMsFor;
export const _testPadRect = padRect;
export const _testDotRadius = dotRadius;
export const _testHaloScale = haloScale;
export const _testStreakTaper = streakTaper;
export const _testRipple = rippleAt;
export const _testChevronSlots = chevronSlots;
export const _testNeedsAnimation = needsAnimation;
export const _testIsActive = isActiveSample;
export const _testDraw = drawTouchpad;
