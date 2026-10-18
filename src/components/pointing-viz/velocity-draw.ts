// Velocity Scroll drawn over a pointing device while the key is held: where
// the anchor is, the dead zone, the offset from the anchor, and the speed that
// offset sets, mapped through the board's own curve. Three looks for owner
// review (?velViz=field|curve|rim); "field" is the default.
//
// Coordinates are CSS px with the device's center at the origin, as in
// overlay-draw.ts. The anchor is the ball's center, or on a touchpad the point
// the finger touched down.
//
// Scales:
// - Touchpad: true size. The offset is the finger's real travel, so the offset
//   line ends exactly under the drawn fingertip, and the dead zone and the speed
//   marks sit at their real distances on the glass.
// - Trackball: the offset is virtual (counts since key-down, like a joystick),
//   and the curve runs to ~30 mm, past the ball's rim. The field fills the ball
//   with a square-root scale per axis, so the 0.8 mm dead zone stays visible and
//   the rim is the point of maximum speed (where the firmware clamps).

import { velocityFullMm, velocityOffsetFor, velocitySpeed, type VelocityCurve, type VelocityScrollState } from "@/utils/velocity-scroll";
import { ease, strokeHair } from "./overlay-draw";

export type VelocityViz = "field" | "curve" | "rim";
export const VELOCITY_VIZ: readonly VelocityViz[] = ["field", "curve", "rim"];
export const DEFAULT_VELOCITY_VIZ: VelocityViz = "field";

/** ?velViz= (review only; never saved). Anything else is the default. */
export function velocityVizFromSearch(search: string): VelocityViz {
    try {
        const v = new URLSearchParams(search).get("velViz")?.trim().toLowerCase();
        return (VELOCITY_VIZ as readonly string[]).includes(v ?? "") ? (v as VelocityViz) : DEFAULT_VELOCITY_VIZ;
    } catch {
        return DEFAULT_VELOCITY_VIZ;
    }
}
let cachedViz: VelocityViz | undefined;
export function velocityViz(): VelocityViz {
    if (cachedViz === undefined) cachedViz = typeof window === "undefined" ? DEFAULT_VELOCITY_VIZ : velocityVizFromSearch(window.location.search);
    return cachedViz;
}
export function _resetVelocityVizForTests() { cachedViz = undefined; }

/**
 * Whether a hand shows Velocity Scroll (its pill and drawing): the pad whose
 * finger sets the offset; otherwise the trackball (the moving one when both
 * hands have one); a pad with no finger in use only when the other hand has
 * no trackball, at the moving hand.
 */
export function velocityHere(
    p: { placement: { kind: "ball" | "pad"; side: "left" | "right" }; showModes: boolean; otherKind?: "ball" | "pad" | null },
    vs: VelocityScrollState | null | undefined,
): boolean {
    if (!vs) return false;
    if (vs.padHand) return vs.padHand === p.placement.side;
    if (p.placement.kind === "ball") return p.otherKind !== "ball" || p.showModes;
    return p.otherKind !== "ball" && p.showModes;
}

/** The speed marks along each axis: where the speed reaches these shares of the maximum. */
export const SPEED_MARKS = [0.25, 0.5, 0.75, 1] as const;

export interface VelocityColors {
    /** The speed (from --kb-pointing-velocity). */
    accent: string;
    /** The curve card in the "curve" look: the pill colors. */
    card: string;
    cardFg: string;
}

/** Used when the tokens can't be read (tests, no document): the token's own value and the light pill. */
export const FALLBACK_VELOCITY_COLORS: VelocityColors = { accent: "#099e7c", card: "#000000", cardFg: "#ffffff" };

/** How a distance along one axis, in mm, is drawn: px from the anchor (signed). */
export type AxisScale = (mm: number) => number;

/**
 * The scale for one device. Touchpad: true size. Trackball: a square-root scale
 * that puts the curve's full-speed offset at `reach` px.
 */
export function velocityScale(kind: "ball" | "pad", c: VelocityCurve, reach: number, pxPerMm: number): AxisScale {
    if (kind === "pad") return (mm) => mm * pxPerMm;
    const full = Math.max(1e-3, velocityFullMm(c));
    return (mm) => Math.sign(mm) * reach * Math.sqrt(Math.min(1, Math.abs(mm) / full));
}

/** Where the full speed is drawn, px from the anchor (the speed's own scale: arrow length / this = share of max). */
export function speedReach(c: VelocityCurve, scale: AxisScale): number {
    return Math.abs(scale(velocityFullMm(c))) || 1;
}

/** The speed arrow's tip for a state, px from the anchor (+x right, +y down on screen). */
export function speedTip(st: VelocityScrollState, c: VelocityCurve, reachPx: number): { x: number; y: number } {
    const max = c.maxNps > 0 ? c.maxNps : 1;
    const f = (v: number) => Math.max(-1, Math.min(1, v / max));
    // +v scrolls up, which is a pull away from the user: up on screen.
    return { x: f(st.speedNps.h) * reachPx, y: -f(st.speedNps.v) * reachPx };
}

export interface VelocityDrawOpts {
    viz: VelocityViz;
    kind: "ball" | "pad";
    side: "left" | "right";
    /** 0..1: eases in and out with the key. */
    amount: number;
    /** The anchor, px from the device's center. */
    anchor: { x: number; y: number };
    /** How far the device reaches from its center, px: the ball's radius, or the pad's half-diagonal. */
    reach: number;
    /** Touchpad px per mm. */
    pxPerMm: number;
    unitPx: number;
    /** Canvas px per CSS px (for hairlines). */
    k: number;
    colors: VelocityColors;
    /** Pill font size, for the curve card's text. */
    fontPx: number;
    /** How far the device reaches below its center, px (the curve card goes under it). */
    bottom: number;
    /** The touchpad's glass (half-extents and corner, px): the field's marks stay on it. */
    glass?: { hw: number; hh: number; corner: number };
}

const TAU = Math.PI * 2;

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, a: number, k: number) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU);
    ctx.fillStyle = `rgba(0,0,0,${0.45 * a})`; ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, Math.max(0.5, r - 1.2 / k), 0, TAU);
    ctx.fillStyle = `rgba(255,255,255,${0.96 * a})`; ctx.fill();
}

function ring(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, a: number, k: number) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); strokeHair(ctx, a, 1.3 / k);
}

/** The dead zone: a square per axis (a sideways wobble inside it never scrolls sideways). */
function deadSquare(ctx: CanvasRenderingContext2D, d: number, a: number, k: number) {
    ctx.beginPath();
    const r = Math.min(d * 0.35, 3);
    if (typeof ctx.roundRect === "function") ctx.roundRect(-d, -d, d * 2, d * 2, r); else ctx.rect(-d, -d, d * 2, d * 2);
    ctx.fillStyle = `rgba(255,255,255,${0.16 * a})`; ctx.fill();
    strokeHair(ctx, a * 0.9, 1.2 / k);
}

/** The offset: a line from the anchor to where the pointer is now, ending in a small ring. */
function offsetStick(ctx: CanvasRenderingContext2D, x: number, y: number, a: number, k: number, unitPx: number) {
    if (Math.hypot(x, y) > 0.5) {
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(x, y);
        ctx.lineCap = "round"; strokeHair(ctx, a * 0.85, 1.4 / k);
    }
    ring(ctx, x, y, Math.max(3, 0.075 * unitPx), a, k);
}

/** The speed: an arrow from the anchor in the brand accent, on a dark bed so it reads on silver and on black pearl. */
function speedArrow(ctx: CanvasRenderingContext2D, x: number, y: number, a: number, k: number, color: string, unitPx: number) {
    const len = Math.hypot(x, y);
    if (len < 1) return;
    const ux = x / len, uy = y / len;
    const w = Math.max(2.4 / k, 0.06 * unitPx);
    const head = Math.min(len * 0.6, Math.max(6, 0.2 * unitPx));
    const bx = x - ux * head, by = y - uy * head;
    const path = () => {
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(bx, by);
    };
    const tip = () => {
        ctx.beginPath(); ctx.moveTo(x, y);
        ctx.lineTo(bx - uy * head * 0.55, by + ux * head * 0.55);
        ctx.lineTo(bx + uy * head * 0.55, by - ux * head * 0.55);
        ctx.closePath();
    };
    ctx.save();
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.globalAlpha = a;
    path(); ctx.strokeStyle = "rgba(0,0,0,0.45)"; ctx.lineWidth = w + 2.6 / k; ctx.stroke();
    tip(); ctx.lineWidth = 2.6 / k; ctx.stroke();
    path(); ctx.strokeStyle = color; ctx.lineWidth = w; ctx.stroke();
    tip(); ctx.fillStyle = color; ctx.fill();
    ctx.restore();
}

/** Each axis: a hairline through the anchor with a tick where the speed reaches each mark. */
function rulers(ctx: CanvasRenderingContext2D, c: VelocityCurve, scale: AxisScale, a: number, k: number, unitPx: number) {
    const marks = SPEED_MARKS.map((f) => Math.abs(scale(velocityOffsetFor(c, f * c.maxNps))));
    const end = marks[marks.length - 1];
    ctx.save();
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-end, 0); ctx.lineTo(end, 0); ctx.moveTo(0, -end); ctx.lineTo(0, end);
    strokeHair(ctx, a * 0.42, 1 / k);
    ctx.beginPath();
    marks.forEach((m, i) => {
        const t = (i === marks.length - 1 ? 0.13 : 0.07) * unitPx;
        for (const s of [-1, 1]) {
            ctx.moveTo(s * m, -t); ctx.lineTo(s * m, t);
            ctx.moveTo(-t, s * m); ctx.lineTo(t, s * m);
        }
    });
    strokeHair(ctx, a * 0.8, 1.2 / k);
    ctx.restore();
}

/** The full-speed circle, dashed: the speed arrow reaches it at the maximum. */
function maxCircle(ctx: CanvasRenderingContext2D, r: number, a: number, k: number) {
    ctx.save();
    if (typeof ctx.setLineDash === "function") ctx.setLineDash([3 / k, 4 / k]);
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); strokeHair(ctx, a * 0.5, 1 / k);
    ctx.restore();
}

/** The speed as an arc on a ring: centered on the scroll direction, wider as it speeds up (half a turn at the maximum). */
function speedArc(ctx: CanvasRenderingContext2D, r: number, tip: { x: number; y: number }, reachPx: number, a: number, k: number, color: string, unitPx: number) {
    const w = Math.max(3 / k, 0.075 * unitPx);
    ctx.save();
    ctx.lineCap = "round";
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU);
    ctx.strokeStyle = `rgba(0,0,0,${0.32 * a})`; ctx.lineWidth = w + 2 / k; ctx.stroke();
    ctx.strokeStyle = `rgba(255,255,255,${0.35 * a})`; ctx.lineWidth = w * 0.45; ctx.stroke();
    const share = Math.min(1, Math.hypot(tip.x, tip.y) / reachPx);
    if (share > 0.005) {
        const mid = Math.atan2(tip.y, tip.x), half = share * Math.PI / 2;
        ctx.beginPath(); ctx.arc(0, 0, r, mid - half, mid + half);
        ctx.globalAlpha = a; ctx.strokeStyle = color; ctx.lineWidth = w; ctx.stroke();
    }
    ctx.restore();
}

/** The curve card: speed over offset, the dead zone shaded, each axis's point riding on it. */
function curveCard(ctx: CanvasRenderingContext2D, st: VelocityScrollState, c: VelocityCurve, o: VelocityDrawOpts) {
    const fs = o.fontPx;
    const w = fs * 9.4, h = fs * 5.6, pad = fs * 0.75;
    // under the device, clear of the pills at its lower outer side
    const x0 = -w / 2, y0 = o.bottom + 0.28 * o.unitPx;
    const a = Math.min(1, o.amount * 1.2), e = ease(o.amount);
    const full = velocityFullMm(c);
    ctx.save();
    ctx.translate(0, (1 - e) * 4);
    ctx.globalAlpha = a;
    ctx.fillStyle = o.colors.card;
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") ctx.roundRect(x0, y0, w, h, fs * 0.7); else ctx.rect(x0, y0, w, h);
    ctx.fill();
    // plot box
    const px0 = x0 + pad, px1 = x0 + w - pad, py0 = y0 + pad + fs * 1.1, py1 = y0 + h - pad;
    const X = (mm: number) => px0 + (px1 - px0) * Math.min(1, mm / full);
    const Y = (nps: number) => py1 - (py1 - py0) * Math.min(1, nps / c.maxNps);
    ctx.fillStyle = o.colors.cardFg;
    ctx.globalAlpha = a * 0.14;
    ctx.fillRect(px0, py0, X(c.deadMm) - px0, py1 - py0);
    ctx.globalAlpha = a * 0.35;
    ctx.fillRect(px0, py1, px1 - px0, Math.max(1, 1 / o.k));
    ctx.globalAlpha = a * 0.9;
    ctx.beginPath();
    for (let i = 0; i <= 48; i++) {
        const mm = (full * i) / 48, y = Y(velocitySpeed(c, mm));
        if (i === 0) ctx.moveTo(X(mm), y); else ctx.lineTo(X(mm), y);
    }
    ctx.strokeStyle = o.colors.cardFg; ctx.lineWidth = Math.max(1.4 / o.k, fs * 0.13); ctx.lineJoin = "round"; ctx.stroke();
    // each axis's point
    const pts: Array<[number, number]> = [[Math.abs(st.offsetMm.x), Math.abs(st.speedNps.h)], [Math.abs(st.offsetMm.y), Math.abs(st.speedNps.v)]];
    for (const [mm, nps] of pts) {
        if (mm < 0.05) continue;
        ctx.globalAlpha = a;
        ctx.beginPath(); ctx.arc(X(mm), Y(nps), fs * 0.32, 0, TAU);
        ctx.fillStyle = o.colors.accent; ctx.fill();
    }
    // the speed now
    const sp = Math.hypot(st.speedNps.h, st.speedNps.v);
    ctx.globalAlpha = a;
    ctx.fillStyle = o.colors.cardFg;
    ctx.font = `600 ${fs}px Inter, system-ui, sans-serif`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText(`${sp < 9.95 ? sp.toFixed(1) : Math.round(sp)}`, x0 + pad, y0 + pad + fs * 0.35);
    ctx.globalAlpha = a * 0.7;
    ctx.textAlign = "right";
    ctx.fillText("notches/s", x0 + w - pad, y0 + pad + fs * 0.35);
    ctx.restore();
}

/**
 * Draws Velocity Scroll over the device. For a touchpad, `anchor` is the
 * touch-down point; on a trackball it is the ball's center.
 */
export function drawVelocity(ctx: CanvasRenderingContext2D, st: VelocityScrollState, o: VelocityDrawOpts) {
    if (o.amount <= 0.001) return;
    const c = o.kind === "pad" ? st.pad : st.ball;
    if (!(c.maxNps > 0)) return;
    const fieldR = o.kind === "ball" ? o.reach * 0.92 : 0;
    const scale = velocityScale(o.kind, c, fieldR, o.pxPerMm);
    const reachPx = speedReach(c, scale);
    const a = Math.min(1, o.amount * 1.3);
    const ox = scale(st.offsetMm.x), oy = scale(st.offsetMm.y);
    const tip = speedTip(st, c, reachPx);
    const d = Math.max(2.5, Math.abs(scale(c.deadMm)));
    ctx.save();
    if (o.viz === "curve") {
        // the card sits beside the device, placed from its center; the rest from the anchor
        curveCard(ctx, st, c, o);
    }
    ctx.translate(o.anchor.x, o.anchor.y);
    if (o.viz === "field") {
        ctx.save();
        if (o.glass) {
            // the marks stay on the glass: past its edge no finger can go
            const g = o.glass;
            ctx.beginPath();
            if (typeof ctx.roundRect === "function") ctx.roundRect(-g.hw - o.anchor.x, -g.hh - o.anchor.y, g.hw * 2, g.hh * 2, g.corner);
            else ctx.rect(-g.hw - o.anchor.x, -g.hh - o.anchor.y, g.hw * 2, g.hh * 2);
            ctx.clip();
        }
        rulers(ctx, c, scale, a, o.k, o.unitPx);
        maxCircle(ctx, reachPx, a, o.k);
        ctx.restore();
        deadSquare(ctx, d, a, o.k);
        offsetStick(ctx, ox, oy, a, o.k, o.unitPx);
        speedArrow(ctx, tip.x, tip.y, a, o.k, o.colors.accent, o.unitPx);
    } else if (o.viz === "curve") {
        deadSquare(ctx, d, a, o.k);
        offsetStick(ctx, ox, oy, a, o.k, o.unitPx);
    } else {
        const r = o.kind === "ball" ? o.reach * 0.97 : Math.max(reachPx * 0.55, 0.9 * o.unitPx);
        speedArc(ctx, r, tip, reachPx, a, o.k, o.colors.accent, o.unitPx);
        ring(ctx, 0, 0, d * 1.15, a, o.k);
        offsetStick(ctx, ox, oy, a, o.k, o.unitPx);
    }
    dot(ctx, 0, 0, Math.max(2.6, 0.06 * o.unitPx), a, o.k);
    ctx.restore();
}
