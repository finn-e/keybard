// Touchpad visualization: a small rounded pad (aspect 1.3:1) with one or two finger
// dots and fading trails. Touch positions are used when the firmware reports them;
// otherwise relative deltas are integrated into a wandering dot that drifts back to
// the centre, and quickly so when idle. See docs/pointing-fragments-spec.md (C5, D).
//
// Modes: pointer = one dot + 600 ms trail; scroll = two parallel dots + accent
// chevrons streaming along the scroll axis in an edge lane; precision = smaller dot
// with a crosshair; boost = larger dot, accent halo, 1200 ms trail. A button press
// flashes the pad outline (150 ms) and pulses the dot. Idle = empty pad with a faint
// dot grid.
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

/** Pad aspect, width / height. */
const PAD_ASPECT = 1.3;
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
/** Button feedback. */
const FLASH_MS = 150;
const PULSE_MS = 380;
/** Reduced motion: at most one static frame per this many ms. */
const STATIC_FRAME_MS = 250;
/** Chevron lane travel speed at full magnitude, lane lengths per ms. */
const CHEVRON_SPEED = 0.0012;
/** Grid shown on the pad (columns x rows of dots). */
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
    /** Base finger dot radius, CSS px. */
    dot: number;
}

/** The pad rectangle (aspect 1.3:1) centred in the drawing area, CSS px. */
export function padRect(width: number, height: number): PadRect {
    const m = Math.max(2, Math.min(width, height) * 0.06);
    const aw = Math.max(1, width - 2 * m);
    const ah = Math.max(1, height - 2 * m);
    const w = Math.min(aw, ah * PAD_ASPECT);
    const h = w / PAD_ASPECT;
    const s = Math.min(w, h);
    return {
        x: (width - w) / 2,
        y: (height - h) / 2,
        w,
        h,
        r: Math.max(3, s * 0.16),
        dot: Math.max(2.5, s * 0.075),
    };
}

/** Dot radius for a mode at a magnitude. */
export function dotRadius(base: number, mode: PointingMode, magnitude: number): number {
    const m = mode === "precision" ? 0.62 : mode === "boost" ? 1.35 : 1;
    return base * m * (1 + 0.15 * clamp(magnitude, 0, 1));
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

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

function drawTrail(
    ctx: CanvasRenderingContext2D,
    trail: TouchpadTrail,
    pad: PadRect,
    now: number,
    maxAgeMs: number,
    width: number,
    color: string,
    alpha: number,
): void {
    const n = trailLiveCount(trail, now, maxAgeMs);
    if (n < 2) return;
    ctx.strokeStyle = color;
    ctx.lineCap = "round";
    const start = trail.count - n;
    let pi = trailIndex(trail, start);
    let px = pad.x + trail.xs[pi] * pad.w;
    let py = pad.y + trail.ys[pi] * pad.h;
    for (let i = start + 1; i < trail.count; i++) {
        const ci = trailIndex(trail, i);
        const cx = pad.x + trail.xs[ci] * pad.w;
        const cy = pad.y + trail.ys[ci] * pad.h;
        const fresh = 1 - clamp((now - trail.ts[ci]) / maxAgeMs, 0, 1);
        ctx.globalAlpha = alpha * fresh * fresh;
        ctx.lineWidth = Math.max(0.75, width * (0.35 + 0.65 * fresh));
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(cx, cy);
        ctx.stroke();
        px = cx;
        py = cy;
        pi = ci;
    }
}

function drawChevron(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    axis: ScrollAxis,
    dir: number,
    size: number,
): void {
    // Unit vector along the axis (pointing in dir) and its normal.
    const ux = axis === "horizontal" ? dir : 0;
    const uy = axis === "vertical" ? dir : 0;
    const nx = -uy;
    const ny = ux;
    ctx.beginPath();
    ctx.moveTo(cx - ux * size * 0.5 + nx * size, cy - uy * size * 0.5 + ny * size);
    ctx.lineTo(cx + ux * size * 0.5, cy + uy * size * 0.5);
    ctx.lineTo(cx - ux * size * 0.5 - nx * size, cy - uy * size * 0.5 - ny * size);
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
    const pad = padRect(o.width, o.height);
    const s = Math.min(pad.w, pad.h);
    const a = state.activity;
    const mode = drawnMode(state, now);

    // Pad body.
    roundRectPath(ctx, pad.x, pad.y, pad.w, pad.h, pad.r);
    ctx.fillStyle = theme.muted;
    ctx.globalAlpha = 0.06 + 0.06 * a;
    ctx.fill();
    ctx.strokeStyle = theme.muted;
    ctx.lineWidth = s > 80 ? 1.5 : 1;
    ctx.globalAlpha = 0.35 + 0.4 * a;
    ctx.stroke();

    // Button flash on the outline.
    const sincePress = now - state.pressT;
    if (sincePress >= 0 && sincePress < FLASH_MS) {
        ctx.strokeStyle = theme.accent;
        ctx.lineWidth = s > 80 ? 2.5 : 2;
        ctx.globalAlpha = 1 - sincePress / FLASH_MS;
        ctx.stroke();
    }

    ctx.save();
    roundRectPath(ctx, pad.x, pad.y, pad.w, pad.h, pad.r);
    ctx.clip();

    // Faint dot grid (the idle image); dims further while active.
    ctx.fillStyle = theme.muted;
    ctx.globalAlpha = 0.35 * (1 - a) + 0.15 * a;
    const gr = Math.max(0.6, s * 0.012);
    for (let gx = 1; gx <= GRID_COLS; gx++) {
        const x = pad.x + (gx / (GRID_COLS + 1)) * pad.w;
        for (let gy = 1; gy <= GRID_ROWS; gy++) {
            const y = pad.y + (gy / (GRID_ROWS + 1)) * pad.h;
            ctx.beginPath();
            ctx.arc(x, y, gr, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    if (a > 0.001) {
        const mag = state.magnitude;
        const r = dotRadius(pad.dot, mode, mag);
        const fingers = state.fingers;

        // Scroll lane with streaming chevrons, on the inboard edge (towards the
        // keyboard's centre) for vertical scroll, or the bottom edge for horizontal.
        if (mode === "scroll") {
            const dir = state.scrollRate < 0 ? -1 : 1;
            const size = Math.max(2, s * 0.07);
            const inset = pad.r * 0.9;
            const vertical = state.axis === "vertical";
            const laneX = vertical ? (o.side === "left" ? pad.x + pad.w - size * 2 : pad.x + size * 2) : 0;
            const laneY = vertical ? 0 : pad.y + pad.h - size * 2;
            const len = vertical ? pad.h - 2 * inset : pad.w - 2 * inset;
            const base = vertical ? pad.y + inset : pad.x + inset;
            ctx.strokeStyle = theme.accent;
            ctx.lineWidth = Math.max(1, s * 0.022);
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            const phase = o.reducedMotion ? 0 : state.scrollPhase;
            const strength = 0.3 + 0.7 * mag;
            for (let i = 0; i < 3; i++) {
                const t = o.reducedMotion ? (i + 1) / 4 : (phase + i / 3) % 1;
                const fade = Math.sin(Math.PI * t);
                ctx.globalAlpha = a * strength * (o.reducedMotion ? 0.9 : fade);
                const p = base + t * len;
                drawChevron(ctx, vertical ? laneX : p, vertical ? p : laneY, state.axis, dir, size);
            }
        }

        // Trails (not in reduced motion).
        if (!o.reducedMotion) {
            const trailMs = trailMsFor(mode);
            const trailColor = mode === "boost" ? theme.accent : mode === "scroll" ? theme.muted : theme.foreground;
            const trailAlpha = a * (mode === "scroll" ? 0.75 : 0.45);
            const tw = r * (mode === "precision" ? 0.7 : 1.1);
            for (let f = 0; f < fingers; f++) {
                drawTrail(ctx, state.trails[f], pad, now, trailMs, tw, trailColor, trailAlpha);
            }
        }

        const d0x = pad.x + state.dotX[0] * pad.w;
        const d0y = pad.y + state.dotY[0] * pad.h;

        // Precision: crosshair through the dot.
        if (mode === "precision") {
            const gap = r * 2.2;
            ctx.strokeStyle = theme.muted;
            ctx.lineWidth = 1;
            ctx.globalAlpha = a * 0.75;
            ctx.beginPath();
            ctx.moveTo(pad.x, d0y);
            ctx.lineTo(d0x - gap, d0y);
            ctx.moveTo(d0x + gap, d0y);
            ctx.lineTo(pad.x + pad.w, d0y);
            ctx.moveTo(d0x, pad.y);
            ctx.lineTo(d0x, d0y - gap);
            ctx.moveTo(d0x, d0y + gap);
            ctx.lineTo(d0x, pad.y + pad.h);
            ctx.stroke();
            ctx.strokeStyle = theme.accent;
            ctx.globalAlpha = a * 0.9;
            ctx.beginPath();
            ctx.arc(d0x, d0y, gap, 0, Math.PI * 2);
            ctx.stroke();
        }

        // Boost: accent halo behind the dot(s), growing with magnitude.
        if (mode === "boost") {
            ctx.fillStyle = theme.accent;
            for (let f = 0; f < fingers; f++) {
                const x = pad.x + state.dotX[f] * pad.w;
                const y = pad.y + state.dotY[f] * pad.h;
                ctx.globalAlpha = a * (0.18 + 0.22 * mag);
                ctx.beginPath();
                ctx.arc(x, y, r * (1.9 + 0.6 * mag), 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // Dots.
        ctx.fillStyle = theme.foreground;
        ctx.globalAlpha = a;
        for (let f = 0; f < fingers; f++) {
            ctx.beginPath();
            ctx.arc(pad.x + state.dotX[f] * pad.w, pad.y + state.dotY[f] * pad.h, r, 0, Math.PI * 2);
            ctx.fill();
        }

        // Reduced motion: a still direction tick from the dot instead of a trail.
        if (o.reducedMotion && mode !== "scroll" && mag > 0.02) {
            const len = Math.hypot(state.rateX, state.rateY);
            if (len > 0) {
                const ux = state.rateX / len;
                const uy = state.rateY / len;
                const l = r + mag * s * 0.3;
                ctx.strokeStyle = theme.foreground;
                ctx.lineWidth = Math.max(1, r * 0.5);
                ctx.lineCap = "round";
                ctx.globalAlpha = a * 0.7;
                ctx.beginPath();
                ctx.moveTo(d0x + ux * r, d0y + uy * r);
                ctx.lineTo(d0x + ux * l, d0y + uy * l);
                ctx.stroke();
            }
        }

        // Tap / click pulse ring.
        if (sincePress >= 0 && sincePress < PULSE_MS && !o.reducedMotion) {
            const p = sincePress / PULSE_MS;
            ctx.strokeStyle = theme.accent;
            ctx.lineWidth = Math.max(1, r * 0.45);
            ctx.globalAlpha = (1 - p) * a;
            for (let f = 0; f < fingers; f++) {
                ctx.beginPath();
                ctx.arc(pad.x + state.dotX[f] * pad.w, pad.y + state.dotY[f] * pad.h, r * (1.2 + 1.6 * p), 0, Math.PI * 2);
                ctx.stroke();
            }
        }
    }
    ctx.restore();
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
export const _testNeedsAnimation = needsAnimation;
export const _testIsActive = isActiveSample;
export const _testDraw = drawTouchpad;
