// Trackball pointing slot: a flow field inside a circle (the ball seen from above).
// Particles are advected by a vector field = smoothed ball velocity, shaped like the
// projected surface motion of a rotating sphere (fastest at the centre, slower toward
// the rim), plus a gentle curl noise. The ball "pushes" the field and it relaxes back
// through the exponential smoothing. See docs/pointing-fragments-spec.md section D.
//
// Pure step/math helpers are exported with a `_test` prefix for unit tests; the
// component keeps all animation state in refs and never calls setState per frame.

import { useEffect, useRef, useState, type JSX } from "react";
import {
    normalizeSpeed,
    setupPointingCanvas,
    POINTING_IDLE_MS,
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

const MAX_PARTICLES = 60;
/** Ease between active and idle, ms. */
const IDLE_EASE_MS = 400;
/** Idle still-image alpha. */
const IDLE_ALPHA = 0.35;
/** Boost entry pulse duration, ms. */
const PULSE_MS = 600;
/** Button flash duration, ms. */
const FLASH_MS = 150;
/** Reduced-motion redraw throttle, ms. */
const STATIC_THROTTLE_MS = 250;
/** Disk radii per second at full magnitude. */
const FLOW_GAIN = 1.5;
/** Disk radii per second for scroll conveyor at full magnitude. */
const SCROLL_GAIN = 1.3;
/** Wheel units are much coarser than counts; scale them to counts for speed. */
const WHEEL_TO_COUNTS = 8;
/** A sample counts as the current target for at most this long, ms. */
const MIN_FRESH_MS = 100;
/** Frame dt clamp, ms (tab switches, debugger pauses). */
const MAX_FRAME_DT = 100;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type ScrollAxis = "vertical" | "horizontal";

export interface FlowState {
    /** Smoothed ball rate, counts/ms (screen axes: +x right, +y down). */
    vx: number;
    vy: number;
    /** Smoothed scroll rate along `axis`, counts/ms, signed in drawn direction. */
    scroll: number;
    /** 0..1 visual magnitude. */
    mag: number;
    /** 0 = idle still image, 1 = fully animated. */
    activity: number;
    mode: PointingMode;
    axis: ScrollAxis;
    lastSample: PointingLiveSample | null;
    /** Local clock (performance.now) when lastSample was first seen. */
    sampleSeenAt: number;
    /** Local clock of the last sample with any motion. */
    lastMotionAt: number;
    /** Remaining boost-entry pulse, ms. */
    pulseMs: number;
    /** Remaining button flash, ms. */
    flashMs: number;
    /** Noise clock, seconds (runs slower in precision). */
    noiseT: number;
    /** Particle positions in unit-disk coordinates. */
    px: Float32Array;
    py: Float32Array;
    /** Last field velocity per particle (disk radii / s), for trail drawing. */
    fx: Float32Array;
    fy: Float32Array;
    /** Age and lifetime, seconds. */
    life: Float32Array;
    maxLife: Float32Array;
    rng: number;
}

function nextRand(s: FlowState): number {
    // xorshift32, deterministic per state.
    let x = s.rng | 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    s.rng = x | 0;
    return (x >>> 0) / 4294967296;
}

function spawnRandom(s: FlowState, i: number): void {
    // Uniform in the disk.
    const r = Math.sqrt(nextRand(s)) * 0.97;
    const a = nextRand(s) * Math.PI * 2;
    s.px[i] = r * Math.cos(a);
    s.py[i] = r * Math.sin(a);
    s.life[i] = 0;
    s.maxLife[i] = 1.6 + nextRand(s) * 2.4;
}

function createFlowState(seed = 1): FlowState {
    const s: FlowState = {
        vx: 0,
        vy: 0,
        scroll: 0,
        mag: 0,
        activity: 0,
        mode: "pointer",
        axis: "vertical",
        lastSample: null,
        sampleSeenAt: -Infinity,
        lastMotionAt: -Infinity,
        pulseMs: 0,
        flashMs: 0,
        noiseT: 0,
        px: new Float32Array(MAX_PARTICLES),
        py: new Float32Array(MAX_PARTICLES),
        fx: new Float32Array(MAX_PARTICLES),
        fy: new Float32Array(MAX_PARTICLES),
        life: new Float32Array(MAX_PARTICLES),
        maxLife: new Float32Array(MAX_PARTICLES),
        rng: (seed * 2654435761) | 0 || 1,
    };
    for (let i = 0; i < MAX_PARTICLES; i++) {
        spawnRandom(s, i);
        // Stagger ages so respawns don't happen in lockstep.
        s.life[i] = nextRand(s) * s.maxLife[i];
    }
    return s;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function hasMotion(s: PointingLiveSample): boolean {
    return s.dx !== 0 || s.dy !== 0 || s.h !== 0 || s.v !== 0;
}

/** Which axis the scroll conveyor runs along for this sample (null = keep previous). */
function scrollAxisOf(s: PointingLiveSample): ScrollAxis | null {
    if (s.axisLock === "horizontal") return "horizontal";
    if (s.axisLock === "vertical") return "vertical";
    if (s.dx !== 0 || s.dy !== 0) return Math.abs(s.dx) > Math.abs(s.dy) ? "horizontal" : "vertical";
    if (s.h !== 0 || s.v !== 0) return Math.abs(s.h) > Math.abs(s.v) ? "horizontal" : "vertical";
    return null;
}

/**
 * Scroll rate along `axis`, counts/ms, signed in drawn screen direction
 * (+ = right / down). Uses the driver's wheel units when present, else dx/dy.
 * naturalScroll flips it so the user sees content direction.
 */
function scrollRateOf(s: PointingLiveSample, axis: ScrollAxis): number {
    const dt = s.dtMs > 0 ? s.dtMs : 33;
    let r: number;
    if (axis === "vertical") r = s.v !== 0 ? (-s.v * WHEEL_TO_COUNTS) / dt : s.dy / dt;
    else r = s.h !== 0 ? (s.h * WHEEL_TO_COUNTS) / dt : s.dx / dt;
    return s.naturalScroll ? -r : r;
}

/** Exponential smoothing factor for a frame of `frameDtMs`. */
function smoothingAlpha(frameDtMs: number, tauMs = POINTING_SMOOTHING_MS): number {
    if (!(frameDtMs > 0)) return 0;
    return 1 - Math.exp(-frameDtMs / tauMs);
}

/** Fold a newly seen sample into the state (mode, pulse, flash, idle clock). */
function ingestSample(s: FlowState, sample: PointingLiveSample, now: number): void {
    const prevMode = s.lastSample ? s.mode : "pointer";
    s.lastSample = sample;
    s.sampleSeenAt = now;
    if (hasMotion(sample)) s.lastMotionAt = now;
    s.mode = sample.mode;
    if (sample.mode === "boost" && prevMode !== "boost") s.pulseMs = PULSE_MS;
    if (sample.buttons !== 0) {
        s.flashMs = FLASH_MS;
        s.lastMotionAt = now;
    }
    if (sample.mode === "scroll") {
        const ax = scrollAxisOf(sample);
        if (ax) s.axis = ax;
    }
}

/**
 * Field velocity at disk point (x, y) in disk radii per second, written into out.
 * Pointer-like modes: sphere-surface projection of the smoothed ball velocity plus
 * curl noise. Scroll: a uniform conveyor along the scroll axis.
 */
function fieldAt(s: FlowState, x: number, y: number, out: { x: number; y: number }): void {
    if (s.mode === "scroll") {
        const v = Math.sign(s.scroll) * normalizeSpeed(s.scroll) * SCROLL_GAIN * s.activity;
        out.x = s.axis === "horizontal" ? v : 0;
        out.y = s.axis === "vertical" ? v : 0;
        return;
    }
    const speed = Math.hypot(s.vx, s.vy);
    const precision = s.mode === "precision" ? 0.5 : 1;
    let bx = 0;
    let by = 0;
    if (speed > 1e-6) {
        const r2 = x * x + y * y;
        // Projected surface speed of a sphere rotating under the finger.
        const surface = 0.5 + 0.5 * Math.sqrt(Math.max(0, 1 - r2));
        const k = (FLOW_GAIN * s.mag * surface * precision) / speed;
        bx = s.vx * k;
        by = s.vy * k;
    }
    // Curl noise from stream function psi = sin(a x + t) cos(b y - t) + 0.5 sin(c (x + y) + 0.9 t).
    const t = s.noiseT;
    const a = 2.1;
    const b = 1.7;
    const c = 1.3;
    const sa = Math.sin(a * x + 0.7 * t);
    const ca = Math.cos(a * x + 0.7 * t);
    const sb = Math.sin(b * y - 0.5 * t);
    const cb = Math.cos(b * y - 0.5 * t);
    const cc = Math.cos(c * (x + y) + 0.9 * t);
    const dPsiDx = a * ca * cb + 0.5 * c * cc;
    const dPsiDy = -b * sa * sb + 0.5 * c * cc;
    const amp = 0.09 * s.activity * (0.4 + s.mag) * precision;
    out.x = bx + amp * dPsiDy;
    out.y = by - amp * dPsiDx;
}

const scratch = { x: 0, y: 0 };

/** Number of particles drawn and advected in the current mode. */
function activeParticleCount(mode: PointingMode): number {
    return mode === "precision" ? MAX_PARTICLES / 2 : MAX_PARTICLES;
}

/** Re-enter a particle that left the disk on the upstream side of the flow. */
function wrapParticle(s: FlowState, i: number): void {
    const x = s.px[i];
    const y = s.py[i];
    let dx = s.fx[i];
    let dy = s.fy[i];
    const dl = Math.hypot(dx, dy);
    let nx: number;
    let ny: number;
    if (dl > 1e-4) {
        dx /= dl;
        dy /= dl;
        // Reflect across the line through the centre perpendicular to the flow:
        // keeps the cross-stream lane, moves to the upstream rim (conveyor).
        const d = x * dx + y * dy;
        nx = x - 2 * d * dx;
        ny = y - 2 * d * dy;
    } else {
        nx = -x;
        ny = -y;
    }
    const r = Math.hypot(nx, ny) || 1;
    const k = (0.96 - nextRand(s) * 0.04) / r;
    s.px[i] = nx * k;
    s.py[i] = ny * k;
    s.life[i] = 0;
}

/**
 * One animation step: smooth toward the latest sample, ease activity, tick timers,
 * advect particles. `now` is the local clock, `frameDtMs` the time since the last step.
 */
function stepFlow(s: FlowState, now: number, frameDtMs: number): void {
    const dt = Math.min(MAX_FRAME_DT, Math.max(0, frameDtMs));
    const sample = s.lastSample;
    const fresh = sample !== null && now - s.sampleSeenAt < Math.max(MIN_FRESH_MS, 3 * (sample.dtMs || 33));
    const sdt = sample && sample.dtMs > 0 ? sample.dtMs : 33;
    const tvx = fresh && sample ? sample.dx / sdt : 0;
    const tvy = fresh && sample ? sample.dy / sdt : 0;
    const tScroll = fresh && sample && s.mode === "scroll" ? scrollRateOf(sample, s.axis) : 0;

    const al = smoothingAlpha(dt);
    s.vx += (tvx - s.vx) * al;
    s.vy += (tvy - s.vy) * al;
    s.scroll += (tScroll - s.scroll) * al;

    const rate = s.mode === "scroll" ? Math.abs(s.scroll) : Math.hypot(s.vx, s.vy);
    s.mag = fresh && sample?.saturated ? 1 : normalizeSpeed(rate);

    const idle = now - s.lastMotionAt > POINTING_IDLE_MS;
    const step = dt / IDLE_EASE_MS;
    s.activity = idle ? Math.max(0, s.activity - step) : Math.min(1, s.activity + step);

    s.pulseMs = Math.max(0, s.pulseMs - dt);
    s.flashMs = Math.max(0, s.flashMs - dt);
    const sec = dt / 1000;
    s.noiseT += sec * (s.mode === "precision" ? 0.5 : 1);

    if (s.activity <= 0) return;
    const n = activeParticleCount(s.mode);
    for (let i = 0; i < n; i++) {
        fieldAt(s, s.px[i], s.py[i], scratch);
        s.fx[i] = scratch.x;
        s.fy[i] = scratch.y;
        s.px[i] += scratch.x * sec;
        s.py[i] += scratch.y * sec;
        s.life[i] += sec;
        if (s.px[i] * s.px[i] + s.py[i] * s.py[i] > 1) wrapParticle(s, i);
        else if (s.life[i] > s.maxLife[i]) spawnRandom(s, i);
    }
}

/** True when the loop can sleep: fully idle and no transient effects running. */
function isSettled(s: FlowState, now: number): boolean {
    return s.activity <= 0 && s.pulseMs <= 0 && s.flashMs <= 0 && now - s.lastMotionAt > POINTING_IDLE_MS;
}

/** Trail length as a fraction of the radius for a particle moving at `speed` radii/s. */
function trailLength(mode: PointingMode, speed: number, mag: number): number {
    if (mode === "scroll") return 0.08 + 0.22 * mag;
    const k = mode === "boost" ? 2 : mode === "precision" ? 0.6 : 1;
    // Trail ∝ magnitude, with a floor so slow particles still read as dots.
    return Math.min(0.7, 0.04 + k * 0.16 * speed * (0.4 + mag));
}

/** Particle alpha from age (fade in after spawn/wrap, fade out before respawn). */
function particleAlpha(life: number, maxLife: number): number {
    const fadeIn = Math.min(1, life / 0.25);
    const fadeOut = Math.min(1, Math.max(0, (maxLife - life) / 0.35));
    return fadeIn * fadeOut;
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

interface Geometry {
    cx: number;
    cy: number;
    r: number;
    lw: number;
}

function geometry(width: number, height: number): Geometry {
    const size = Math.max(1, Math.min(width, height));
    const lw = Math.min(2, Math.max(0.75, size / 75));
    return { cx: width / 2, cy: height / 2, r: Math.max(4, size / 2 - lw * 2 - 1), lw };
}

const IDLE_RINGS = [0.32, 0.58, 0.84];
const IDLE_DASH_FRACTION = 0.55;

function drawOutline(ctx: CanvasRenderingContext2D, g: Geometry, theme: PointingVizTheme, flash: number): void {
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = theme.muted;
    ctx.lineWidth = g.lw;
    ctx.beginPath();
    ctx.arc(g.cx, g.cy, g.r, 0, Math.PI * 2);
    ctx.stroke();
    if (flash > 0) {
        ctx.globalAlpha = flash;
        ctx.strokeStyle = theme.accent;
        ctx.lineWidth = g.lw * 2.5;
        ctx.beginPath();
        ctx.arc(g.cx, g.cy, g.r, 0, Math.PI * 2);
        ctx.stroke();
    }
}

/** Faint static field lines circling the centre: arcs with a small chevron each. */
function drawIdle(ctx: CanvasRenderingContext2D, g: Geometry, theme: PointingVizTheme, alpha: number, cw: boolean): void {
    if (alpha <= 0.001) return;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = theme.muted;
    ctx.lineWidth = g.lw;
    ctx.lineCap = "round";
    const dir = cw ? 1 : -1;
    for (let k = 0; k < IDLE_RINGS.length; k++) {
        const rr = IDLE_RINGS[k] * g.r;
        const start = k * 2.1 + 0.4;
        const span = Math.PI * 2 * IDLE_DASH_FRACTION;
        for (let half = 0; half < 2; half++) {
            const a0 = start + half * Math.PI;
            const a1 = a0 + span / 2;
            ctx.beginPath();
            ctx.arc(g.cx, g.cy, rr, a0, a1);
            ctx.stroke();
            // Chevron at the leading end pointing along the circulation.
            const ae = cw ? a1 : a0;
            const ex = g.cx + rr * Math.cos(ae);
            const ey = g.cy + rr * Math.sin(ae);
            const tx = -Math.sin(ae) * dir;
            const ty = Math.cos(ae) * dir;
            const hs = Math.max(2, g.r * 0.09);
            ctx.beginPath();
            ctx.moveTo(ex - tx * hs + ty * hs * 0.6, ey - ty * hs - tx * hs * 0.6);
            ctx.lineTo(ex, ey);
            ctx.lineTo(ex - tx * hs - ty * hs * 0.6, ey - ty * hs + tx * hs * 0.6);
            ctx.stroke();
        }
    }
}

function drawPrecisionRings(ctx: CanvasRenderingContext2D, g: Geometry, theme: PointingVizTheme, alpha: number): void {
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = theme.muted;
    ctx.lineWidth = Math.max(0.5, g.lw * 0.5);
    ctx.beginPath();
    for (let k = 1; k <= 3; k++) {
        const rr = (k / 4) * g.r;
        ctx.moveTo(g.cx + rr, g.cy);
        ctx.arc(g.cx, g.cy, rr, 0, Math.PI * 2);
    }
    // Fine reticle ticks at the quadrant points.
    const t0 = g.r * 0.88;
    const t1 = g.r * 0.98;
    ctx.moveTo(g.cx + t0, g.cy);
    ctx.lineTo(g.cx + t1, g.cy);
    ctx.moveTo(g.cx - t0, g.cy);
    ctx.lineTo(g.cx - t1, g.cy);
    ctx.moveTo(g.cx, g.cy + t0);
    ctx.lineTo(g.cx, g.cy + t1);
    ctx.moveTo(g.cx, g.cy - t0);
    ctx.lineTo(g.cx, g.cy - t1);
    ctx.stroke();
}

/** Small grab marker at the centre for scroll (drag-scroll pins the field under it). */
function drawGrabPoint(ctx: CanvasRenderingContext2D, g: Geometry, theme: PointingVizTheme, alpha: number, axis: ScrollAxis): void {
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = g.lw;
    const rr = Math.max(2.5, g.r * 0.1);
    ctx.beginPath();
    ctx.arc(g.cx, g.cy, rr, 0, Math.PI * 2);
    ctx.stroke();
    // Track rails along the scroll axis.
    ctx.globalAlpha = alpha * 0.45;
    ctx.lineWidth = Math.max(0.5, g.lw * 0.6);
    ctx.beginPath();
    const e = g.r * 0.92;
    if (axis === "vertical") {
        ctx.moveTo(g.cx, g.cy - e);
        ctx.lineTo(g.cx, g.cy - rr * 1.6);
        ctx.moveTo(g.cx, g.cy + rr * 1.6);
        ctx.lineTo(g.cx, g.cy + e);
    } else {
        ctx.moveTo(g.cx - e, g.cy);
        ctx.lineTo(g.cx - rr * 1.6, g.cy);
        ctx.moveTo(g.cx + rr * 1.6, g.cy);
        ctx.lineTo(g.cx + e, g.cy);
    }
    ctx.stroke();
}

const ALPHA_BUCKETS = [0.33, 0.66, 1];

/** Full animated frame from the state. */
function drawFlowFrame(ctx: CanvasRenderingContext2D, s: FlowState, width: number, height: number, theme: PointingVizTheme): void {
    ctx.clearRect(0, 0, width, height);
    const g = geometry(width, height);
    const act = s.activity;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    drawIdle(ctx, g, theme, IDLE_ALPHA * (1 - act), true);

    if (act > 0) {
        if (s.mode === "precision") drawPrecisionRings(ctx, g, theme, 0.55 * act);

        ctx.save();
        ctx.beginPath();
        ctx.arc(g.cx, g.cy, g.r - g.lw * 0.5, 0, Math.PI * 2);
        ctx.clip();

        const scroll = s.mode === "scroll";
        const boost = s.mode === "boost";
        const precision = s.mode === "precision";
        ctx.strokeStyle = scroll ? theme.accent : theme.foreground;
        ctx.lineWidth = g.lw * (precision ? 0.7 : boost ? 1.35 : scroll ? 1.3 : 1.1);
        const base = act * (boost ? 1 : precision ? 0.75 : 0.85);
        const n = activeParticleCount(s.mode);
        for (let b = 0; b < ALPHA_BUCKETS.length; b++) {
            const lo = b === 0 ? 0 : ALPHA_BUCKETS[b - 1];
            const hi = ALPHA_BUCKETS[b];
            ctx.globalAlpha = base * hi;
            ctx.beginPath();
            let any = false;
            for (let i = 0; i < n; i++) {
                const a = particleAlpha(s.life[i], s.maxLife[i]);
                if (a <= lo || a > hi) continue;
                const fx = s.fx[i];
                const fy = s.fy[i];
                const sp = Math.hypot(fx, fy);
                const len = trailLength(s.mode, sp, s.mag) * g.r;
                const x = g.cx + s.px[i] * g.r;
                const y = g.cy + s.py[i] * g.r;
                ctx.moveTo(x, y);
                if (sp > 1e-4) ctx.lineTo(x - (fx / sp) * len, y - (fy / sp) * len);
                else ctx.lineTo(x + 0.01, y);
                any = true;
            }
            if (any) ctx.stroke();
        }
        ctx.restore();

        if (scroll) drawGrabPoint(ctx, g, theme, act, s.axis);
    }

    if (s.pulseMs > 0) {
        const p = 1 - s.pulseMs / PULSE_MS;
        ctx.globalAlpha = (1 - p) * 0.9;
        ctx.strokeStyle = theme.accent;
        ctx.lineWidth = g.lw * 1.5;
        ctx.beginPath();
        ctx.arc(g.cx, g.cy, Math.max(1, g.r * (0.15 + 0.85 * p)), 0, Math.PI * 2);
        ctx.stroke();
    }

    drawOutline(ctx, g, theme, s.flashMs / FLASH_MS);
    ctx.globalAlpha = 1;
}

function drawArrow(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, head: number): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const l = Math.hypot(dx, dy);
    if (l < 0.5) return;
    const ux = dx / l;
    const uy = dy / l;
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.moveTo(x1 - ux * head + uy * head * 0.6, y1 - uy * head - ux * head * 0.6);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x1 - ux * head - uy * head * 0.6, y1 - uy * head + ux * head * 0.6);
}

/** Direction and 0..1 magnitude a single still frame shows for a sample. */
function staticGlyph(sample: PointingLiveSample | null): { mode: PointingMode | "idle"; ux: number; uy: number; mag: number; axis: ScrollAxis } {
    if (!sample || (!hasMotion(sample) && sample.buttons === 0)) return { mode: "idle", ux: 0, uy: 0, mag: 0, axis: "vertical" };
    const dt = sample.dtMs > 0 ? sample.dtMs : 33;
    if (sample.mode === "scroll") {
        const axis = scrollAxisOf(sample) ?? "vertical";
        const r = scrollRateOf(sample, axis);
        const sign = r < 0 ? -1 : 1;
        return {
            mode: "scroll",
            ux: axis === "horizontal" ? sign : 0,
            uy: axis === "vertical" ? sign : 0,
            mag: sample.saturated ? 1 : normalizeSpeed(r),
            axis,
        };
    }
    const vx = sample.dx / dt;
    const vy = sample.dy / dt;
    const sp = Math.hypot(vx, vy);
    if (sp < 1e-6) return { mode: "idle", ux: 0, uy: 0, mag: 0, axis: "vertical" };
    return { mode: sample.mode, ux: vx / sp, uy: vy / sp, mag: sample.saturated ? 1 : normalizeSpeed(sp), axis: "vertical" };
}

/** Reduced-motion still frame: direction and magnitude as a glyph, no particles. */
function drawStaticFrame(ctx: CanvasRenderingContext2D, sample: PointingLiveSample | null, width: number, height: number, theme: PointingVizTheme): void {
    ctx.clearRect(0, 0, width, height);
    const g = geometry(width, height);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const glyph = staticGlyph(sample);
    if (glyph.mode === "idle") {
        drawIdle(ctx, g, theme, IDLE_ALPHA, true);
        drawOutline(ctx, g, theme, sample && sample.buttons !== 0 ? 1 : 0);
        ctx.globalAlpha = 1;
        return;
    }
    const head = Math.max(2.5, g.r * 0.16);
    const len = g.r * (0.35 + 0.55 * glyph.mag);
    // Perpendicular for parallel streamlines.
    const nx = -glyph.uy;
    const ny = glyph.ux;
    if (glyph.mode === "scroll") {
        drawGrabPoint(ctx, g, theme, 1, glyph.axis);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = theme.accent;
        ctx.lineWidth = g.lw * 1.3;
        ctx.beginPath();
        for (const off of [-0.45, 0.45]) {
            const ox = g.cx + nx * off * g.r;
            const oy = g.cy + ny * off * g.r;
            drawArrow(ctx, ox - glyph.ux * len * 0.5, oy - glyph.uy * len * 0.5, ox + glyph.ux * len * 0.5, oy + glyph.uy * len * 0.5, head);
        }
        ctx.stroke();
    } else {
        if (glyph.mode === "precision") drawPrecisionRings(ctx, g, theme, 0.55);
        ctx.globalAlpha = glyph.mode === "boost" ? 1 : 0.85;
        ctx.strokeStyle = theme.foreground;
        ctx.lineWidth = g.lw * (glyph.mode === "precision" ? 0.6 : glyph.mode === "boost" ? 1.6 : 1.1);
        ctx.beginPath();
        for (const off of [-0.42, 0, 0.42]) {
            // Sphere falloff: outer streamlines are shorter.
            const l = len * (off === 0 ? 1 : 0.7);
            const ox = g.cx + nx * off * g.r;
            const oy = g.cy + ny * off * g.r;
            drawArrow(ctx, ox - glyph.ux * l * 0.5, oy - glyph.uy * l * 0.5, ox + glyph.ux * l * 0.5, oy + glyph.uy * l * 0.5, head * (off === 0 ? 1 : 0.75));
        }
        ctx.stroke();
        if (glyph.mode === "boost") {
            ctx.globalAlpha = 0.7;
            ctx.strokeStyle = theme.accent;
            ctx.lineWidth = g.lw * 1.2;
            ctx.beginPath();
            ctx.arc(g.cx, g.cy, g.r * 0.93, 0, Math.PI * 2);
            ctx.stroke();
        }
    }
    drawOutline(ctx, g, theme, sample && sample.buttons !== 0 ? 1 : 0);
    ctx.globalAlpha = 1;
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

function wakes(s: FlowState, sample: PointingLiveSample): boolean {
    return hasMotion(sample) || sample.buttons !== 0 || sample.mode !== s.mode;
}

export function TrackballFlowViz(props: PointingVizProps): JSX.Element {
    const { source, side, width, height, reducedMotion, theme, className } = props;
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const wrapRef = useRef<HTMLDivElement>(null);
    const themeRef = useRef(theme);
    themeRef.current = theme;
    const stateRef = useRef<FlowState | null>(null);
    if (stateRef.current === null) stateRef.current = createFlowState(side === "right" ? 7 : 3);
    const redrawRef = useRef<(() => void) | null>(null);
    const dpr = useDevicePixelRatio();

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = setupPointingCanvas(canvas, width, height);
        const state = stateRef.current as FlowState;
        const src: PointingSampleSource = source;

        if (reducedMotion) {
            let lastDraw = -Infinity;
            let timer: ReturnType<typeof setTimeout> | undefined;
            const draw = () => {
                timer = undefined;
                lastDraw = now();
                if (ctx) drawStaticFrame(ctx, src.latest(), width, height, themeRef.current);
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
            stepFlow(state, t, dt);
            if (ctx) drawFlowFrame(ctx, state, width, height, themeRef.current);
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
            if (!running && ctx) drawFlowFrame(ctx, state, width, height, themeRef.current);
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
    MAX_PARTICLES,
    PULSE_MS,
    FLASH_MS,
    IDLE_EASE_MS,
    createFlowState,
    hasMotion,
    scrollAxisOf,
    scrollRateOf,
    smoothingAlpha,
    ingestSample,
    fieldAt,
    activeParticleCount,
    stepFlow,
    isSettled,
    trailLength,
    particleAlpha,
    staticGlyph,
    drawFlowFrame,
    drawStaticFrame,
};
