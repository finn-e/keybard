// TrackpointViz: the TrackPoint drawn as a single vector. A fixed nub sits at the
// centre; an arrow grows from it in the push direction, with length and thickness
// following the smoothed push speed, and springs back (with a little overshoot)
// when released. Modes (docs/pointing-fragments-spec.md, section D):
//   idle      small dot at centre, low alpha
//   pointer   arrow, length ∝ magnitude (max 45% of size), head width ∝ magnitude
//   scroll    double-headed track along the scroll axis, accent chevrons streaming
//             in the push direction, accent bar from the nub
//   precision thin 1px, shorter arrow with three tick marks along it (a scale)
//   boost     thick arrow with an accent glow
// All animation state lives in refs; the per-frame path allocates nothing.

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

/** Spring constant (1/s²) and damping ratio for the arrow's spring-back. */
const SPRING_K = 320;
const SPRING_ZETA = 0.5;
/** Rate smoothing time constant once the push is released, ms. */
const RELEASE_SMOOTHING_MS = 30;
/** Largest integration step for the spring, ms (sub-stepped above this). */
const MAX_SUBSTEP_MS = 16;
/** Longest frame dt considered, ms (tab switches, debugger pauses). */
const MAX_FRAME_DT_MS = 100;
/** Ease into / out of the idle state over this long, ms. */
const IDLE_EASE_MS = 400;
/** Mode decorations fade in over this long, ms. */
const MODE_FADE_MS = 200;
/** Button flash length, ms. */
const BUTTON_FLASH_MS = 150;
/** Wheel units are coarse: one wheel unit ≈ this many counts for the visual. */
const WHEEL_TO_COUNTS = 8;
/** Scroll chevrons travel this many track-lengths per second at full magnitude. */
const SCROLL_STREAM_RATE = 1.4;
/** Idle alpha (spec: 0.35). */
const IDLE_ALPHA = 0.35;
const SCROLL_CHEVRONS = 3;

// ---------------------------------------------------------------------------
// Pure state and math (exported with _test prefixes for unit tests)
// ---------------------------------------------------------------------------

export interface TrackpointState {
    /** Smoothed rate, counts/ms (scroll mode substitutes driver wheel units). */
    vx: number;
    vy: number;
    /** Spring-driven arrow vector in magnitude units (≈0..1, may overshoot). */
    ax: number;
    ay: number;
    /** Spring velocity, magnitude units per second. */
    avx: number;
    avy: number;
    /** Last meaningful arrow direction, radians (kept when the arrow is ~0). */
    angle: number;
    mode: PointingMode;
    modeSince: number;
    /** 0 = active .. 1 = fully idle (linear; eased when drawn). */
    idle: number;
    lastSampleT: number;
    lastMotionT: number;
    /** Chevron stream phase, 0..1. */
    scrollPhase: number;
    scrollAxis: "vertical" | "horizontal";
    /** Last non-zero scroll direction along the axis, ±1 (screen coordinates). */
    scrollSign: number;
    flashUntil: number;
    saturated: boolean;
    axisLock: AxisLock;
    naturalScroll: boolean;
    hasSample: boolean;
}

export function createTrackpointState(): TrackpointState {
    return {
        vx: 0,
        vy: 0,
        ax: 0,
        ay: 0,
        avx: 0,
        avy: 0,
        angle: -Math.PI / 2,
        mode: "pointer",
        modeSince: -Infinity,
        idle: 1,
        lastSampleT: Number.NaN,
        lastMotionT: -Infinity,
        scrollPhase: 0,
        scrollAxis: "vertical",
        scrollSign: 1,
        flashUntil: -Infinity,
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
            if (sample.buttons !== 0) st.flashUntil = now + BUTTON_FLASH_MS;
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

    // Exponential velocity smoothing (frame-rate independent). Smoothing is there
    // to hide jitter between 33 ms samples while pushing; on release (target is
    // exactly zero) the rate collapses faster so the spring visibly snaps back.
    const released = tx === 0 && ty === 0;
    const tau = released ? RELEASE_SMOOTHING_MS : POINTING_SMOOTHING_MS;
    const a = snap ? 1 : 1 - Math.exp(-dt / tau);
    st.vx += (tx - st.vx) * a;
    st.vy += (ty - st.vy) * a;

    // Target arrow vector, magnitude units.
    const speed = Math.hypot(st.vx, st.vy);
    let gx = 0;
    let gy = 0;
    if (st.mode === "scroll") {
        st.scrollAxis = scrollAxisFor(st.axisLock, st.vx, st.vy);
        let along = st.scrollAxis === "vertical" ? st.vy : st.vx;
        if (st.naturalScroll) along = -along;
        const m = st.saturated ? 1 : normalizeSpeed(along);
        const sign = along > 0 ? 1 : along < 0 ? -1 : 0;
        if (sign !== 0 && m > 0.02) st.scrollSign = sign;
        if (st.scrollAxis === "vertical") gy = sign * m;
        else gx = sign * m;
        st.scrollPhase += (sign * m * SCROLL_STREAM_RATE * dt) / 1000;
        st.scrollPhase -= Math.floor(st.scrollPhase);
    } else if (speed > 1e-6) {
        const m = st.saturated ? 1 : normalizeSpeed(speed);
        gx = (st.vx / speed) * m;
        gy = (st.vy / speed) * m;
    }

    // Spring the arrow towards the target (overshoots a little on release).
    if (snap) {
        st.ax = gx;
        st.ay = gy;
        st.avx = 0;
        st.avy = 0;
    } else {
        const c = 2 * SPRING_ZETA * Math.sqrt(SPRING_K);
        let remaining = dt;
        while (remaining > 0) {
            const h = Math.min(MAX_SUBSTEP_MS, remaining) / 1000;
            remaining -= MAX_SUBSTEP_MS;
            st.avx += (SPRING_K * (gx - st.ax) - c * st.avx) * h;
            st.avy += (SPRING_K * (gy - st.ay) - c * st.avy) * h;
            st.ax += st.avx * h;
            st.ay += st.avy * h;
        }
    }
    if (Math.hypot(st.ax, st.ay) > 0.01) st.angle = Math.atan2(st.ay, st.ax);

    // Idle easing.
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
        now >= st.flashUntil &&
        Math.abs(st.ax) < 1e-3 &&
        Math.abs(st.ay) < 1e-3 &&
        Math.abs(st.avx) < 1e-2 &&
        Math.abs(st.avy) < 1e-2
    );
}

export interface ArrowGeometry {
    /** Draw the arrow at all (it is hidden while it is still inside the nub). */
    visible: boolean;
    /** Direction, radians, screen coordinates. */
    angle: number;
    /** Tip distance from the centre, CSS px. */
    length: number;
    shaftWidth: number;
    headLength: number;
    headWidth: number;
    /** Tick marks along the shaft (precision). */
    ticks: number;
    /** shadowBlur for the accent glow (boost), CSS px. */
    glow: number;
    nubRadius: number;
    /** Radius of the full-scale range ring. */
    rangeRadius: number;
}

export function createArrowGeometry(): ArrowGeometry {
    return {
        visible: false,
        angle: 0,
        length: 0,
        shaftWidth: 0,
        headLength: 0,
        headWidth: 0,
        ticks: 0,
        glow: 0,
        nubRadius: 0,
        rangeRadius: 0,
    };
}

/** Nub radius for a drawing size: readable at 60 px, not blobby at 140 px. */
export function nubRadiusFor(size: number): number {
    return Math.max(3, size * 0.075);
}

/**
 * Arrow geometry for a spring vector (ax, ay) in a `size` px square, per mode.
 * Pure; writes into `out`.
 */
export function arrowGeometry(ax: number, ay: number, angle: number, mode: PointingMode, size: number, out: ArrowGeometry): ArrowGeometry {
    const mag = Math.min(1.15, Math.hypot(ax, ay));
    const maxLen = 0.45 * size;
    const nub = nubRadiusFor(size);
    out.angle = angle;
    out.nubRadius = nub;
    out.rangeRadius = maxLen;
    out.ticks = 0;
    out.glow = 0;
    switch (mode) {
        case "precision":
            out.length = mag * maxLen * 0.62;
            out.shaftWidth = 1;
            out.headLength = Math.max(3, size * 0.055);
            out.headWidth = Math.max(3.5, size * 0.06);
            out.ticks = 3;
            break;
        case "boost":
            out.length = mag * maxLen;
            out.shaftWidth = Math.max(2.5, size * (0.05 + 0.035 * mag));
            out.headLength = Math.max(5, size * (0.09 + 0.08 * mag));
            out.headWidth = Math.max(7, size * (0.12 + 0.12 * mag));
            out.glow = 6;
            break;
        case "scroll":
            out.length = mag * maxLen * 0.85;
            out.shaftWidth = Math.max(2, size * 0.04);
            out.headLength = 0;
            out.headWidth = 0;
            break;
        default:
            out.length = mag * maxLen;
            out.shaftWidth = Math.max(1.5, size * (0.022 + 0.035 * mag));
            out.headLength = Math.max(4, size * (0.06 + 0.07 * mag));
            out.headWidth = Math.max(5, size * (0.07 + 0.11 * mag));
    }
    // Never let the head be longer than about half the arrow.
    out.headLength = Math.min(out.headLength, out.length * 0.55);
    out.visible = out.length > nub + 1;
    return out;
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

function smoothstep(x: number): number {
    const t = Math.max(0, Math.min(1, x));
    return t * t * (3 - 2 * t);
}

function fillArrow(ctx: CanvasRenderingContext2D, g: ArrowGeometry, from: number): void {
    const shaftEnd = Math.max(from, g.length - g.headLength);
    const hw = g.shaftWidth / 2;
    ctx.beginPath();
    ctx.moveTo(from, -hw);
    ctx.lineTo(shaftEnd, -hw);
    if (g.headLength > 0) {
        ctx.lineTo(shaftEnd, -g.headWidth / 2);
        ctx.lineTo(g.length, 0);
        ctx.lineTo(shaftEnd, g.headWidth / 2);
    } else {
        ctx.lineTo(g.length, -hw);
        ctx.arc(g.length, 0, hw, -Math.PI / 2, Math.PI / 2);
    }
    ctx.lineTo(shaftEnd, hw);
    ctx.lineTo(from, hw);
    ctx.closePath();
    ctx.fill();
}

function chevron(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, dirX: number, dirY: number): void {
    // Chevron pointing along (dirX, dirY); (px, py) is perpendicular.
    const px = -dirY;
    const py = dirX;
    ctx.beginPath();
    ctx.moveTo(x - dirX * size * 0.5 + px * size, y - dirY * size * 0.5 + py * size);
    ctx.lineTo(x + dirX * size * 0.5, y + dirY * size * 0.5);
    ctx.lineTo(x - dirX * size * 0.5 - px * size, y - dirY * size * 0.5 - py * size);
    ctx.stroke();
}

function drawScroll(
    ctx: CanvasRenderingContext2D,
    st: TrackpointState,
    g: ArrowGeometry,
    theme: PointingVizTheme,
    size: number,
    active: number,
    modeIn: number,
    animated: boolean,
): void {
    const vertical = st.scrollAxis === "vertical";
    const ux = vertical ? 0 : 1;
    const uy = vertical ? 1 : 0;
    const half = size * 0.42;
    const head = Math.max(3, size * 0.05);

    // Double-headed track (muted).
    ctx.globalAlpha = active * modeIn * 0.6;
    ctx.strokeStyle = theme.muted;
    ctx.lineWidth = Math.max(1, size * 0.015);
    ctx.beginPath();
    ctx.moveTo(-ux * half, -uy * half);
    ctx.lineTo(ux * half, uy * half);
    ctx.stroke();
    for (let e = -1; e <= 1; e += 2) {
        const ex = ux * half * e;
        const ey = uy * half * e;
        ctx.beginPath();
        ctx.moveTo(ex - ux * head * e - uy * head * 0.8, ey - uy * head * e - ux * head * 0.8);
        ctx.lineTo(ex, ey);
        ctx.lineTo(ex - ux * head * e + uy * head * 0.8, ey - uy * head * e + ux * head * 0.8);
        ctx.stroke();
    }

    // Streaming chevrons (accent), pointing and moving in the push direction.
    const mag = Math.min(1, Math.hypot(st.ax, st.ay));
    const sign = st.scrollSign;
    const dirX = ux * sign;
    const dirY = uy * sign;
    const span = half * 0.9;
    const chev = Math.max(2.5, size * 0.055);
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = Math.max(1.25, size * 0.02);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (let i = 0; i < SCROLL_CHEVRONS; i++) {
        // With reduced motion the chevrons sit still, evenly spaced.
        let u = i / SCROLL_CHEVRONS + (animated ? st.scrollPhase : 1 / (2 * SCROLL_CHEVRONS));
        u -= Math.floor(u);
        const p = -span + 2 * span * u;
        const fade = Math.sin(Math.PI * u);
        ctx.globalAlpha = active * modeIn * fade * (0.2 + 0.8 * Math.min(1, mag * 1.6));
        chevron(ctx, ux * p, uy * p, chev, dirX, dirY);
    }

    // Accent bar from the nub along the push direction.
    if (g.visible) {
        ctx.globalAlpha = active;
        ctx.fillStyle = theme.accent;
        ctx.save();
        ctx.rotate(Math.atan2(st.ay, st.ax));
        fillArrow(ctx, g, 0);
        ctx.restore();
    }
}

/** Renders one frame. `animated` false = reduced-motion still glyph. */
export function drawTrackpoint(
    ctx: CanvasRenderingContext2D,
    st: TrackpointState,
    g: ArrowGeometry,
    theme: PointingVizTheme,
    width: number,
    height: number,
    now: number,
    animated: boolean,
): void {
    ctx.clearRect(0, 0, width, height);
    const size = Math.min(width, height);
    arrowGeometry(st.ax, st.ay, st.angle, st.mode, size, g);
    const idleE = smoothstep(st.idle);
    const active = 1 - idleE;
    const modeIn = animated ? smoothstep((now - st.modeSince) / MODE_FADE_MS) : 1;

    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Faint range ring: where full push would reach.
    if (active > 0.001) {
        ctx.globalAlpha = 0.18 * active;
        ctx.strokeStyle = theme.muted;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(0, 0, g.rangeRadius, 0, Math.PI * 2);
        ctx.stroke();
    }

    if (active > 0.001) {
        if (st.mode === "scroll") {
            drawScroll(ctx, st, g, theme, size, active, modeIn, animated);
        } else if (g.visible) {
            ctx.save();
            ctx.rotate(g.angle);
            ctx.globalAlpha = active;
            ctx.fillStyle = theme.foreground;
            if (g.glow > 0) {
                ctx.shadowColor = theme.accent;
                ctx.shadowBlur = g.glow * modeIn;
            }
            fillArrow(ctx, g, 0);
            ctx.shadowBlur = 0;
            if (g.ticks > 0) {
                // Scale ticks along a precision arrow.
                ctx.strokeStyle = theme.accent;
                ctx.lineWidth = 1;
                ctx.globalAlpha = active * modeIn;
                const tick = Math.max(2.5, size * 0.04);
                for (let i = 1; i <= g.ticks; i++) {
                    const x = (g.rangeRadius * 0.62 * i) / (g.ticks + 1);
                    if (x > g.length - g.headLength) break;
                    ctx.beginPath();
                    ctx.moveTo(x, -tick);
                    ctx.lineTo(x, tick);
                    ctx.stroke();
                }
            }
            ctx.restore();
        }
    }

    // The nub. Shrinks to a small idle dot.
    const r = g.nubRadius * (1 - 0.4 * idleE);
    ctx.globalAlpha = 1 - (1 - IDLE_ALPHA) * idleE;
    ctx.fillStyle = theme.muted;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    if (active > 0.001) {
        ctx.globalAlpha = active;
        ctx.strokeStyle = theme.foreground;
        ctx.lineWidth = 1;
        ctx.stroke();
        // Dimple pushed slightly toward the push direction: the nub deflects.
        const mag = Math.min(1, Math.hypot(st.ax, st.ay));
        const off = r * 0.35 * mag;
        ctx.fillStyle = theme.foreground;
        ctx.beginPath();
        ctx.arc(Math.cos(st.angle) * off, Math.sin(st.angle) * off, r * 0.4, 0, Math.PI * 2);
        ctx.fill();
    }

    // Button flash on the module outline.
    if (now < st.flashUntil) {
        ctx.globalAlpha = Math.max(0, (st.flashUntil - now) / BUTTON_FLASH_MS);
        ctx.strokeStyle = theme.accent;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, size * 0.47, 0, Math.PI * 2);
        ctx.stroke();
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
    const geomRef = useRef<ArrowGeometry | null>(null);
    if (geomRef.current === null) geomRef.current = createArrowGeometry();
    const themeRef = useRef(theme);
    themeRef.current = theme;
    const redrawRef = useRef<() => void>(() => {});
    const dpr = useDevicePixelRatio();

    useEffect(() => {
        const st = stateRef.current as TrackpointState;
        const g = geomRef.current as ArrowGeometry;
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
                drawTrackpoint(ctx, st, g, themeRef.current, width, height, now, animated);
            } catch {
                // A canvas failure must never take the layout down.
            }
        };

        if (reducedMotion) {
            // No loop: one static frame per sample, at most every 250 ms (trailing).
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
                // Calm idle frame is on screen: sleep until a sample wakes us.
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
            if (sampleHasMotion(s) || s.buttons !== 0 || s.mode !== st.mode) start();
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
    }, [theme.foreground, theme.muted, theme.accent]);

    const label = `${side === "left" ? "Left" : "Right"} trackpoint`;
    return (
        <div ref={wrapRef} role="img" aria-label={label} className={className} style={{ width, height, position: "relative" }}>
            <canvas ref={canvasRef} aria-hidden="true" style={{ display: "block", width, height }} />
        </div>
    );
}

// Test hooks for the pure helpers (spec E).
export const _testCreateState = createTrackpointState;
export const _testStep = stepTrackpoint;
export const _testIsSettled = isTrackpointSettled;
export const _testArrowGeometry = arrowGeometry;
export const _testCreateArrowGeometry = createArrowGeometry;
export const _testSampleRate = sampleRate;
export const _testScrollAxis = scrollAxisFor;
export const _testDraw = drawTrackpoint;
