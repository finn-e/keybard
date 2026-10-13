// Trackball pointing slot: a glossy ball in its socket, seen from above. Dots fixed
// to the ball's surface turn with it: the ball's motion (dx, dy) rolls the near face
// in that direction, so the dots sweep across the middle and foreshorten and fade
// as they wrap round the edge. Lit from the upper left, with a specular highlight
// and a rim bounce. Scroll locks the roll to the scroll axis and shows its
// direction; precision rolls slower under a fine reticle; boost rolls faster with
// motion blur and a pulse. See docs/pointing-fragments-spec.md section D.
//
// The component keeps all animation state in refs and never calls setState per
// frame. Pure helpers are exported as _testTrackball for unit tests.

import { useEffect, useRef, useState, type JSX } from "react";
import {
    normalizeSpeed,
    setupPointingCanvas,
    POINTING_SMOOTHING_MS,
    type PointingLiveSample,
    type PointingMode,
    type PointingSampleSource,
    type PointingVizProps,
    type PointingVizTheme,
} from "./types";

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** Dots on the ball's surface (spread evenly, a Fibonacci sphere). */
const DOT_COUNT = 150;
/** Dot radius as a fraction of the ball's radius. */
const DOT_RADIUS = 0.05;
/** Ball radius as a fraction of the smaller side of the slot. */
const BALL_RADIUS = 0.36;
/** Ball radii of surface travel per second at full speed, per mode. */
const ROLL_GAIN: Record<PointingMode, number> = { pointer: 3.2, scroll: 2.6, precision: 1.3, boost: 5 };
/** Wheel units are much coarser than counts; scale them to counts for speed. */
const WHEEL_TO_COUNTS = 8;
/** A sample drives the ball for at most this long after it arrives, ms. */
const MIN_FRESH_MS = 100;
/** Frame dt clamp, ms (tab switches, debugger pauses). */
const MAX_FRAME_DT = 100;
/** Below this surface speed (radii/s) with nothing else animating, the loop stops. */
const SETTLED_SPEED = 0.01;
/** Boost entry pulse, button flash, ms. */
const PULSE_MS = 600;
const FLASH_MS = 150;
/** Reduced-motion redraw throttle, ms. */
const STATIC_THROTTLE_MS = 250;
/** Re-orthonormalize the orientation this often (frames) so rounding can't skew it. */
const ORTHO_EVERY = 120;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type ScrollAxis = "vertical" | "horizontal";

export interface BallState {
    /** Orientation: row-major 3x3 rotation taking the ball's own frame to the view. */
    rot: Float64Array;
    /** Dots in the ball's own frame, unit vectors (x, y, z per dot). */
    dots: Float32Array;
    /** Smoothed surface velocity, counts/ms, screen axes (+x right, +y down). */
    vx: number;
    vy: number;
    mode: PointingMode;
    axis: ScrollAxis;
    /** Remaining boost pulse and button flash, ms. */
    pulseMs: number;
    flashMs: number;
    lastSample: PointingLiveSample | null;
    sampleSeenAt: number;
    frames: number;
}

function fibonacciSphere(n: number): Float32Array {
    const out = new Float32Array(n * 3);
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
        const y = 1 - (2 * (i + 0.5)) / n;
        const r = Math.sqrt(1 - y * y);
        const a = golden * i;
        out[i * 3] = Math.cos(a) * r;
        out[i * 3 + 1] = y;
        out[i * 3 + 2] = Math.sin(a) * r;
    }
    return out;
}

function createBallState(side: "left" | "right" = "left"): BallState {
    const rot = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    // Start the two hands at different orientations so they don't look cloned.
    rotate(rot, 0.6, 0.8, 0, side === "right" ? 1.1 : 0.4);
    return {
        rot,
        dots: fibonacciSphere(DOT_COUNT),
        vx: 0,
        vy: 0,
        mode: "pointer",
        axis: "vertical",
        pulseMs: 0,
        flashMs: 0,
        lastSample: null,
        sampleSeenAt: -Infinity,
        frames: 0,
    };
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function hasMotion(s: PointingLiveSample): boolean {
    return s.dx !== 0 || s.dy !== 0 || s.h !== 0 || s.v !== 0;
}

/** Which axis a scroll runs along for this sample (null = keep the previous one). */
function scrollAxisOf(s: PointingLiveSample): ScrollAxis | null {
    if (s.axisLock === "horizontal") return "horizontal";
    if (s.axisLock === "vertical") return "vertical";
    if (s.dx !== 0 || s.dy !== 0) return Math.abs(s.dx) > Math.abs(s.dy) ? "horizontal" : "vertical";
    if (s.h !== 0 || s.v !== 0) return Math.abs(s.h) > Math.abs(s.v) ? "horizontal" : "vertical";
    return null;
}

/** Exponential smoothing factor for a frame of frameDtMs. */
function smoothingAlpha(frameDtMs: number, tauMs = POINTING_SMOOTHING_MS): number {
    if (!(frameDtMs > 0)) return 0;
    return 1 - Math.exp(-frameDtMs / tauMs);
}

/**
 * The surface velocity a sample asks for, counts/ms in screen axes. Scroll rolls
 * along its axis only, from the driver's wheel units when it sent any, drawn the
 * way the content moves (naturalScroll flips it).
 */
function targetVelocity(sample: PointingLiveSample, axis: ScrollAxis): { x: number; y: number } {
    const dt = sample.dtMs > 0 ? sample.dtMs : 33;
    if (sample.mode !== "scroll") return { x: sample.dx / dt, y: sample.dy / dt };
    const flip = sample.naturalScroll ? -1 : 1;
    if (axis === "vertical") return { x: 0, y: (flip * (sample.v !== 0 ? -sample.v * WHEEL_TO_COUNTS : sample.dy)) / dt };
    return { x: (flip * (sample.h !== 0 ? sample.h * WHEEL_TO_COUNTS : sample.dx)) / dt, y: 0 };
}

/** Fold a newly seen sample into the state (mode, axis, pulse, flash). */
function ingestSample(s: BallState, sample: PointingLiveSample, now: number): void {
    const wasBoost = s.lastSample !== null && s.mode === "boost";
    s.lastSample = sample;
    s.sampleSeenAt = now;
    s.mode = sample.mode;
    if (sample.mode === "boost" && !wasBoost) s.pulseMs = PULSE_MS;
    if (sample.buttons !== 0) s.flashMs = FLASH_MS;
    if (sample.mode === "scroll") {
        const axis = scrollAxisOf(sample);
        if (axis) s.axis = axis;
    }
}

/** rot = R(axis, angle) * rot, axis (ax, ay, az) normalized here. */
function rotate(rot: Float64Array, ax: number, ay: number, az: number, angle: number): void {
    const len = Math.hypot(ax, ay, az);
    if (!(len > 0) || angle === 0) return;
    const x = ax / len, y = ay / len, z = az / len;
    const c = Math.cos(angle), sn = Math.sin(angle), t = 1 - c;
    const m00 = t * x * x + c, m01 = t * x * y - sn * z, m02 = t * x * z + sn * y;
    const m10 = t * x * y + sn * z, m11 = t * y * y + c, m12 = t * y * z - sn * x;
    const m20 = t * x * z - sn * y, m21 = t * y * z + sn * x, m22 = t * z * z + c;
    for (let col = 0; col < 3; col++) {
        const r0 = rot[col], r1 = rot[3 + col], r2 = rot[6 + col];
        rot[col] = m00 * r0 + m01 * r1 + m02 * r2;
        rot[3 + col] = m10 * r0 + m11 * r1 + m12 * r2;
        rot[6 + col] = m20 * r0 + m21 * r1 + m22 * r2;
    }
}

/** Gram-Schmidt on the rows, so the orientation stays a rotation. */
function orthonormalize(rot: Float64Array): void {
    let l = Math.hypot(rot[0], rot[1], rot[2]);
    rot[0] /= l; rot[1] /= l; rot[2] /= l;
    const d = rot[0] * rot[3] + rot[1] * rot[4] + rot[2] * rot[5];
    rot[3] -= d * rot[0]; rot[4] -= d * rot[1]; rot[5] -= d * rot[2];
    l = Math.hypot(rot[3], rot[4], rot[5]);
    rot[3] /= l; rot[4] /= l; rot[5] /= l;
    rot[6] = rot[1] * rot[5] - rot[2] * rot[4];
    rot[7] = rot[2] * rot[3] - rot[0] * rot[5];
    rot[8] = rot[0] * rot[4] - rot[1] * rot[3];
}

/** Surface speed in ball radii per second for the smoothed velocity. */
function rollSpeed(s: BallState): number {
    return normalizeSpeed(Math.hypot(s.vx, s.vy)) * ROLL_GAIN[s.mode];
}

/**
 * Advance one frame: ease the velocity toward the current sample (or to rest once
 * it is stale), then roll the ball. View axes: +x right, +y down, +z toward the
 * viewer. Rolling about (-uy, ux, 0) carries the near face along (ux, uy).
 */
/** The latest sample still drives the ball. */
function isFresh(s: BallState, now: number): boolean {
    const sample = s.lastSample;
    return sample !== null && now - s.sampleSeenAt <= Math.max(MIN_FRESH_MS, sample.dtMs * 1.5);
}

function stepBall(s: BallState, now: number, frameDtMs: number): void {
    const dt = Math.min(Math.max(frameDtMs, 0), MAX_FRAME_DT);
    const sample = s.lastSample;
    const target = sample && isFresh(s, now) ? targetVelocity(sample, s.axis) : { x: 0, y: 0 };
    const a = smoothingAlpha(dt);
    s.vx += (target.x - s.vx) * a;
    s.vy += (target.y - s.vy) * a;
    s.pulseMs = Math.max(0, s.pulseMs - dt);
    s.flashMs = Math.max(0, s.flashMs - dt);

    const speed = Math.hypot(s.vx, s.vy);
    if (speed > 0) {
        const ux = s.vx / speed, uy = s.vy / speed;
        rotate(s.rot, -uy, ux, 0, (rollSpeed(s) * dt) / 1000);
    }
    if (++s.frames % ORTHO_EVERY === 0) orthonormalize(s.rot);
}

/** Nothing left to animate: no fresh motion to follow, the ball at rest, no pulse or flash. */
function isSettled(s: BallState, now: number): boolean {
    if (s.lastSample && hasMotion(s.lastSample) && isFresh(s, now)) return false;
    return rollSpeed(s) < SETTLED_SPEED && s.pulseMs <= 0 && s.flashMs <= 0;
}

/** A dot in view space. */
function dotInView(s: BallState, i: number, out: { x: number; y: number; z: number }): void {
    const r = s.rot, d = s.dots, p = i * 3;
    out.x = r[0] * d[p] + r[1] * d[p + 1] + r[2] * d[p + 2];
    out.y = r[3] * d[p] + r[4] * d[p + 1] + r[5] * d[p + 2];
    out.z = r[6] * d[p] + r[7] * d[p + 1] + r[8] * d[p + 2];
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

interface Geometry {
    cx: number;
    cy: number;
    r: number;
}

function geometry(width: number, height: number): Geometry {
    return { cx: width / 2, cy: height / 2, r: Math.min(width, height) * BALL_RADIUS };
}

const view = { x: 0, y: 0, z: 0 };
/** Dots are batched into fills by how far they face the viewer. */
const DEPTH_BUCKETS = [0.25, 0.55, 1.01];
const DEPTH_ALPHA = [0.22, 0.45, 0.7];

function drawSocket(ctx: CanvasRenderingContext2D, g: Geometry, theme: PointingVizTheme, flash: number): void {
    const { cx, cy, r } = g;
    // Shadow the ball throws into the socket, offset away from the light.
    const sx = cx + r * 0.08, sy = cy + r * 0.12;
    const shadow = ctx.createRadialGradient(sx, sy, r * 0.7, sx, sy, r * 1.18);
    shadow.addColorStop(0, "rgba(0,0,0,0.3)");
    shadow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = shadow;
    ctx.beginPath();
    ctx.arc(sx, sy, r * 1.18, 0, Math.PI * 2);
    ctx.fill();
    // The socket's lip.
    ctx.lineWidth = Math.max(1, r * 0.06);
    ctx.strokeStyle = flash > 0 ? theme.accent : theme.border;
    ctx.globalAlpha = flash > 0 ? 0.6 + 0.4 * flash : 1;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
}

function drawBody(ctx: CanvasRenderingContext2D, g: Geometry, theme: PointingVizTheme): void {
    const { cx, cy, r } = g;
    ctx.fillStyle = theme.accent;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    // Diffuse light from the upper left, falling off to the lower right.
    const light = ctx.createRadialGradient(cx - r * 0.4, cy - r * 0.45, r * 0.05, cx - r * 0.2, cy - r * 0.2, r * 1.35);
    light.addColorStop(0, "rgba(255,255,255,0.45)");
    light.addColorStop(0.45, "rgba(255,255,255,0.06)");
    light.addColorStop(0.75, "rgba(0,0,0,0.12)");
    light.addColorStop(1, "rgba(0,0,0,0.5)");
    ctx.fillStyle = light;
    ctx.fill();
}

/** The dot fills, one per depth bucket, offset back along the roll by `back` (ball radii at the near face). */
function fillDots(ctx: CanvasRenderingContext2D, s: BallState, g: Geometry, dotR: number, back: { x: number; y: number }, alphaScale: number): void {
    const { cx, cy, r } = g;
    let lo = -0.02;
    for (let b = 0; b < DEPTH_BUCKETS.length; b++) {
        const hi = DEPTH_BUCKETS[b];
        ctx.globalAlpha = DEPTH_ALPHA[b] * alphaScale;
        ctx.beginPath();
        let any = false;
        for (let i = 0; i < DOT_COUNT; i++) {
            dotInView(s, i, view);
            if (view.z <= lo || view.z > hi) continue;
            any = true;
            // The near face moves fastest; a ghost falls back less toward the edge.
            const x = cx + (view.x - back.x * view.z) * r, y = cy + (view.y - back.y * view.z) * r;
            // A round mark on a sphere projects to an ellipse squashed toward the centre.
            const angle = Math.atan2(view.y, view.x);
            const squash = Math.max(0.12, view.z);
            ctx.moveTo(x + dotR * squash * Math.cos(angle), y + dotR * squash * Math.sin(angle));
            ctx.ellipse(x, y, dotR * squash, dotR, angle, 0, Math.PI * 2);
        }
        if (any) ctx.fill();
        lo = hi;
    }
}

const GHOSTS = 3;

function drawDots(ctx: CanvasRenderingContext2D, s: BallState, g: Geometry, blur: number): void {
    const dotR = g.r * DOT_RADIUS * (s.mode === "precision" ? 0.75 : 1);
    ctx.fillStyle = "rgba(10,14,24,1)";
    // Motion blur: fading ghosts of each dot where it was a moment ago.
    const speed = Math.hypot(s.vx, s.vy);
    const reach = blur * rollSpeed(s) * 0.045;
    if (speed > 0 && reach > 0.01) {
        const ux = s.vx / speed, uy = s.vy / speed;
        for (let k = GHOSTS; k >= 1; k--) {
            const f = (k / GHOSTS) * reach;
            fillDots(ctx, s, g, dotR, { x: ux * f, y: uy * f }, 0.35 * (1 - k / (GHOSTS + 1)));
        }
    }
    fillDots(ctx, s, g, dotR, { x: 0, y: 0 }, 1);
    ctx.globalAlpha = 1;
}

function drawGloss(ctx: CanvasRenderingContext2D, g: Geometry): void {
    const { cx, cy, r } = g;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    // Limb darkening over the dots, so they sink into the edge.
    const limb = ctx.createRadialGradient(cx, cy, r * 0.62, cx, cy, r);
    limb.addColorStop(0, "rgba(0,0,0,0)");
    limb.addColorStop(1, "rgba(0,0,0,0.38)");
    ctx.fillStyle = limb;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    // Soft window reflection, then the hot spot.
    const hx = cx - r * 0.38, hy = cy - r * 0.42;
    const soft = ctx.createRadialGradient(hx, hy, 0, hx, hy, r * 0.55);
    soft.addColorStop(0, "rgba(255,255,255,0.55)");
    soft.addColorStop(0.5, "rgba(255,255,255,0.14)");
    soft.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = soft;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.beginPath();
    ctx.ellipse(hx, hy, r * 0.13, r * 0.08, -Math.PI / 4, 0, Math.PI * 2);
    ctx.fill();
    // Light bounced back from the socket along the lower right edge.
    ctx.lineWidth = r * 0.07;
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.9, Math.PI * 0.05, Math.PI * 0.55);
    ctx.stroke();
    ctx.restore();
}

/** Scroll: chevrons outside the ball along the axis, pointing the way the content moves. */
function drawScrollGuides(ctx: CanvasRenderingContext2D, s: BallState, g: Geometry, theme: PointingVizTheme, now: number): void {
    const { cx, cy, r } = g;
    const along = s.axis === "vertical" ? s.vy : s.vx;
    const dir = along >= 0 ? 1 : -1;
    const strength = normalizeSpeed(along);
    const size = r * 0.14;
    const gap = r * 1.24;
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = Math.max(1.2, r * 0.07);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // Two chevrons at each end; when scrolling, the leading ones brighten in turn.
    const phase = strength > 0.02 ? (now / 400) % 1 : 0;
    for (const end of [-1, 1]) {
        for (let k = 0; k < 2; k++) {
            const offset = gap + k * size * 0.6;
            const lead = end === dir;
            const pulse = lead && strength > 0.02 ? 0.35 + 0.65 * Math.abs(Math.sin((phase + k * 0.5) * Math.PI)) : 0.3;
            ctx.globalAlpha = pulse;
            const pointing = end; // chevrons point outward
            ctx.beginPath();
            if (s.axis === "vertical") {
                const y = cy + end * offset;
                ctx.moveTo(cx - size, y - pointing * size * 0.55);
                ctx.lineTo(cx, y);
                ctx.lineTo(cx + size, y - pointing * size * 0.55);
            } else {
                const x = cx + end * offset;
                ctx.moveTo(x - pointing * size * 0.55, cy - size);
                ctx.lineTo(x, cy);
                ctx.lineTo(x - pointing * size * 0.55, cy + size);
            }
            ctx.stroke();
        }
    }
    ctx.globalAlpha = 1;
}

/** Precision: a fine reticle over the ball. */
function drawReticle(ctx: CanvasRenderingContext2D, g: Geometry, theme: PointingVizTheme): void {
    const { cx, cy, r } = g;
    ctx.strokeStyle = theme.foreground;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        ctx.moveTo(cx + dx * r * 0.3, cy + dy * r * 0.3);
        ctx.lineTo(cx + dx * r * 1.25, cy + dy * r * 1.25);
    }
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
}

/** Boost: a ring expanding from the ball as boost starts. */
function drawPulse(ctx: CanvasRenderingContext2D, g: Geometry, theme: PointingVizTheme, pulseMs: number): void {
    if (pulseMs <= 0) return;
    const t = 1 - pulseMs / PULSE_MS;
    ctx.strokeStyle = theme.accent;
    ctx.globalAlpha = 0.7 * (1 - t);
    ctx.lineWidth = Math.max(1, g.r * 0.08 * (1 - t));
    ctx.beginPath();
    ctx.arc(g.cx, g.cy, g.r * (1.05 + 0.25 * t), 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
}

function drawBallFrame(ctx: CanvasRenderingContext2D, s: BallState, width: number, height: number, theme: PointingVizTheme, now: number): void {
    ctx.clearRect(0, 0, width, height);
    const g = geometry(width, height);
    drawSocket(ctx, g, theme, s.flashMs / FLASH_MS);
    drawBody(ctx, g, theme);
    drawDots(ctx, s, g, s.mode === "boost" ? 2 : 1);
    drawGloss(ctx, g);
    if (s.mode === "scroll") drawScrollGuides(ctx, s, g, theme, now);
    if (s.mode === "precision") drawReticle(ctx, g, theme);
    drawPulse(ctx, g, theme, s.pulseMs);
}

/**
 * Reduced motion: the ball as it is, plus the mode's still marks. The ball turns
 * by a fixed step toward each sample's motion, so a moving ball still reads.
 */
function drawStaticFrame(ctx: CanvasRenderingContext2D, s: BallState, sample: PointingLiveSample | null, width: number, height: number, theme: PointingVizTheme): void {
    if (sample && sample !== s.lastSample) {
        ingestSample(s, sample, 0);
        const v = targetVelocity(sample, s.axis);
        const speed = Math.hypot(v.x, v.y);
        if (speed > 0) rotate(s.rot, -v.y / speed, v.x / speed, 0, 0.35);
        s.vx = v.x;
        s.vy = v.y;
    }
    s.pulseMs = 0;
    s.flashMs = 0;
    const blur = 0;
    ctx.clearRect(0, 0, width, height);
    const g = geometry(width, height);
    drawSocket(ctx, g, theme, 0);
    drawBody(ctx, g, theme);
    drawDots(ctx, s, g, blur);
    drawGloss(ctx, g);
    if (s.mode === "scroll") drawScrollGuides(ctx, s, g, theme, 0);
    if (s.mode === "precision") drawReticle(ctx, g, theme);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function now(): number {
    return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function currentDpr(): number {
    return typeof window !== "undefined" && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
}

/** Tracks devicePixelRatio (zoom, moving between monitors). */
function useDevicePixelRatio(): number {
    const [dpr, setDpr] = useState(currentDpr);
    useEffect(() => {
        if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
        let mql: MediaQueryList | null = null;
        const onChange = () => {
            setDpr(currentDpr());
            listen();
        };
        const listen = () => {
            mql?.removeEventListener?.("change", onChange);
            try {
                mql = window.matchMedia(`(resolution: ${currentDpr()}dppx)`);
                mql.addEventListener?.("change", onChange);
            } catch {
                mql = null;
            }
        };
        listen();
        return () => mql?.removeEventListener?.("change", onChange);
    }, []);
    return dpr;
}

function wakes(s: BallState, sample: PointingLiveSample): boolean {
    return hasMotion(sample) || sample.buttons !== 0 || sample.mode !== s.mode;
}

export function TrackballFlowViz(props: PointingVizProps): JSX.Element {
    const { source, side, width, height, reducedMotion, theme, className } = props;
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const wrapRef = useRef<HTMLDivElement>(null);
    const themeRef = useRef(theme);
    themeRef.current = theme;
    const stateRef = useRef<BallState | null>(null);
    if (stateRef.current === null) stateRef.current = createBallState(side);
    const redrawRef = useRef<(() => void) | null>(null);
    const dpr = useDevicePixelRatio();

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = setupPointingCanvas(canvas, width, height);
        const state = stateRef.current as BallState;
        const src: PointingSampleSource = source;

        if (reducedMotion) {
            let lastDraw = -Infinity;
            let timer: ReturnType<typeof setTimeout> | undefined;
            const draw = () => {
                timer = undefined;
                lastDraw = now();
                if (ctx) drawStaticFrame(ctx, state, src.latest(), width, height, themeRef.current);
            };
            redrawRef.current = draw;
            draw();
            const unsub = src.subscribe(() => {
                if (timer !== undefined) return;
                const wait = STATIC_THROTTLE_MS - (now() - lastDraw);
                if (wait <= 0) draw();
                else timer = setTimeout(draw, wait);
            });
            return () => {
                unsub();
                if (timer !== undefined) clearTimeout(timer);
                redrawRef.current = null;
            };
        }

        let raf = 0;
        let running = false;
        let visible = true;
        let lastFrame = now();
        const frame = () => {
            raf = 0;
            const t = now();
            const dt = t - lastFrame;
            lastFrame = t;
            const latest = src.latest();
            if (latest && latest !== state.lastSample) ingestSample(state, latest, t);
            stepBall(state, t, dt);
            if (ctx) drawBallFrame(ctx, state, width, height, themeRef.current, t);
            if (isSettled(state, t)) {
                running = false;
                return;
            }
            raf = requestAnimationFrame(frame);
        };
        const wake = () => {
            if (running || !visible) return;
            running = true;
            lastFrame = now();
            raf = requestAnimationFrame(frame);
        };
        const stop = () => {
            if (raf) cancelAnimationFrame(raf);
            raf = 0;
            running = false;
        };
        redrawRef.current = () => {
            if (!running && ctx) drawBallFrame(ctx, state, width, height, themeRef.current, now());
        };

        const unsub = src.subscribe((sample) => {
            if (!running && wakes(state, sample)) wake();
        });

        let io: IntersectionObserver | null = null;
        if (typeof IntersectionObserver !== "undefined" && wrapRef.current) {
            io = new IntersectionObserver((entries) => {
                const e = entries[entries.length - 1];
                if (!e) return;
                visible = e.isIntersecting;
                if (visible) wake();
                else stop();
            });
            io.observe(wrapRef.current);
        }

        wake();
        return () => {
            unsub();
            stop();
            io?.disconnect();
            redrawRef.current = null;
        };
    }, [source, width, height, reducedMotion, dpr]);

    // Theme switch while the loop sleeps (idle or reduced motion): repaint once.
    const drawnThemeRef = useRef(theme);
    useEffect(() => {
        if (drawnThemeRef.current === theme) return;
        drawnThemeRef.current = theme;
        redrawRef.current?.();
    }, [theme]);

    const label = `${side === "right" ? "Right" : "Left"} trackball`;
    return (
        <div ref={wrapRef} role="img" aria-label={label} className={className} style={{ width, height, position: "relative" }}>
            <canvas ref={canvasRef} aria-hidden="true" style={{ display: "block", width, height }} />
        </div>
    );
}

/** Pure helpers, exported for unit tests only. */
export const _testTrackball = {
    DOT_COUNT,
    PULSE_MS,
    FLASH_MS,
    fibonacciSphere,
    createBallState,
    hasMotion,
    scrollAxisOf,
    smoothingAlpha,
    targetVelocity,
    ingestSample,
    rotate,
    orthonormalize,
    rollSpeed,
    stepBall,
    isSettled,
    dotInView,
    drawBallFrame,
    drawStaticFrame,
};
