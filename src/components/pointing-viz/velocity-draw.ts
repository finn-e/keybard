// Velocity Scroll drawn over a pointing device while the key is held: the
// anchor, the dead zone, the offset from the anchor, and the speed that offset
// sets, on the board's own curve.
//
// Coordinates are CSS px with the device's center at the origin, as in
// overlay-draw.ts. The anchor is the ball's center, or on a touchpad the point
// where the finger touched down.
//
// The field: a hairline through the anchor on each axis, ticked where the speed
// reaches 25, 50, 75 and 100% of the maximum, a dashed full-speed circle, the
// dead zone (a square: it is per axis), the offset line, and the speed as an
// arrow in the brand green that reaches the circle at full speed.
//
// Both devices use one scale: square root per axis, with the full-speed offset
// at the field's radius. The curve runs to ~30 mm, past a ball's rim, and the
// marks that matter (a 0.8-1.5 mm dead zone, the first quarter of the speed)
// sit in the first few millimeters, so a true-size field would be too small to
// read. On a trackball the field fills the ball. On a touchpad it is a
// magnified lens anchored at the touch-down point, with a minimum size so it
// stays legible at every key size; the fingertip is drawn where it really is.

import { velocityFullMm, velocityOffsetFor, type VelocityCurve, type VelocityScrollState } from "@/utils/velocity-scroll";
import { strokeHair } from "./overlay-draw";

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
}

/** Used when the tokens can't be read (tests, no document): the token's own value. */
export const FALLBACK_VELOCITY_COLORS: VelocityColors = { accent: "#099e7c" };

/** How a distance along one axis, in mm, is drawn: px from the anchor (signed). */
export type AxisScale = (mm: number) => number;

/** Square root per axis, with the curve's full-speed offset at `radius` px (and clamped there, as the firmware clamps). */
export function velocityScale(c: VelocityCurve, radius: number): AxisScale {
    const full = Math.max(1e-3, velocityFullMm(c));
    return (mm) => Math.sign(mm) * radius * Math.sqrt(Math.min(1, Math.abs(mm) / full));
}

/**
 * The touchpad lens's radius, px: about 1.35 key units, never under 64 px, so
 * the dead zone and the marks stay readable on small and medium keys.
 */
export const PAD_LENS_MIN_PX = 64;
export function padLensRadius(unitPx: number): number {
    return Math.max(PAD_LENS_MIN_PX, 1.35 * unitPx);
}

/** The speed arrow's tip for a state, px from the anchor (+x right, +y down on screen). */
export function speedTip(st: VelocityScrollState, c: VelocityCurve, radius: number): { x: number; y: number } {
    const max = c.maxNps > 0 ? c.maxNps : 1;
    const f = (v: number) => Math.max(-1, Math.min(1, v / max));
    // +v scrolls up, which is a pull away from the user: up on screen.
    return { x: f(st.speedNps.h) * radius, y: -f(st.speedNps.v) * radius };
}

export interface VelocityDrawOpts {
    kind: "ball" | "pad";
    /** 0..1: eases in and out with the key. */
    amount: number;
    /** The anchor, px from the device's center. */
    anchor: { x: number; y: number };
    /** The ball's radius, px (trackball). */
    reach: number;
    unitPx: number;
    /** Canvas px per CSS px (for hairlines). */
    k: number;
    colors: VelocityColors;
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
function offsetStick(ctx: CanvasRenderingContext2D, x: number, y: number, a: number, k: number, size: number) {
    if (Math.hypot(x, y) > 0.5) {
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(x, y);
        ctx.lineCap = "round"; strokeHair(ctx, a * 0.85, 1.4 / k);
    }
    ring(ctx, x, y, Math.max(3, 0.075 * size), a, k);
}

/** The speed: an arrow from the anchor in the brand accent, on a dark bed so it reads on silver, black pearl and glass. */
function speedArrow(ctx: CanvasRenderingContext2D, x: number, y: number, a: number, k: number, color: string, size: number) {
    const len = Math.hypot(x, y);
    if (len < 1) return;
    const ux = x / len, uy = y / len;
    const w = Math.max(2.4 / k, 0.06 * size);
    const head = Math.min(len * 0.6, Math.max(6, 0.2 * size));
    const bx = x - ux * head, by = y - uy * head;
    const shaft = () => { ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(bx, by); };
    const tip = () => {
        ctx.beginPath(); ctx.moveTo(x, y);
        ctx.lineTo(bx - uy * head * 0.55, by + ux * head * 0.55);
        ctx.lineTo(bx + uy * head * 0.55, by - ux * head * 0.55);
        ctx.closePath();
    };
    ctx.save();
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.globalAlpha = a;
    shaft(); ctx.strokeStyle = "rgba(0,0,0,0.45)"; ctx.lineWidth = w + 2.6 / k; ctx.stroke();
    tip(); ctx.lineWidth = 2.6 / k; ctx.stroke();
    shaft(); ctx.strokeStyle = color; ctx.lineWidth = w; ctx.stroke();
    tip(); ctx.fillStyle = color; ctx.fill();
    ctx.restore();
}

/** Each axis: a hairline through the anchor with a tick where the speed reaches each mark. */
function rulers(ctx: CanvasRenderingContext2D, c: VelocityCurve, scale: AxisScale, a: number, k: number, size: number) {
    const marks = SPEED_MARKS.map((f) => Math.abs(scale(velocityOffsetFor(c, f * c.maxNps))));
    const end = marks[marks.length - 1];
    ctx.save();
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-end, 0); ctx.lineTo(end, 0); ctx.moveTo(0, -end); ctx.lineTo(0, end);
    strokeHair(ctx, a * 0.42, 1 / k);
    ctx.beginPath();
    marks.forEach((m, i) => {
        const t = Math.max(i === marks.length - 1 ? 5 : 3, (i === marks.length - 1 ? 0.13 : 0.07) * size);
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

/** The touchpad's lens: a darker disc with a fine rim, so the field reads as a magnified view, apart from the fingertip. */
function lens(ctx: CanvasRenderingContext2D, r: number, a: number, k: number) {
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU);
    ctx.fillStyle = `rgba(0,0,0,${0.38 * a})`; ctx.fill();
    strokeHair(ctx, a * 0.55, 1.1 / k);
}

/**
 * Draws Velocity Scroll's field over the device. For a touchpad, `anchor` is
 * the touch-down point and the field is a lens there; on a trackball it fills
 * the ball from its center.
 */
export function drawVelocity(ctx: CanvasRenderingContext2D, st: VelocityScrollState, o: VelocityDrawOpts) {
    if (o.amount <= 0.001) return;
    const c = o.kind === "pad" ? st.pad : st.ball;
    if (!(c.maxNps > 0)) return;
    // the field's radius: inside the ball's rim, or the lens on the pad
    const radius = o.kind === "ball" ? o.reach * 0.92 : padLensRadius(o.unitPx) * 0.86;
    // marks and strokes are sized from the field, so a small ball or lens keeps them in proportion
    const size = Math.max(o.unitPx, radius / 1.2);
    const scale = velocityScale(c, radius);
    const a = Math.min(1, o.amount * 1.3);
    const ox = scale(st.offsetMm.x), oy = scale(st.offsetMm.y);
    const tip = speedTip(st, c, radius);
    const d = Math.max(3, Math.abs(scale(c.deadMm)));
    ctx.save();
    ctx.translate(o.anchor.x, o.anchor.y);
    if (o.kind === "pad") lens(ctx, padLensRadius(o.unitPx), a, o.k);
    rulers(ctx, c, scale, a, o.k, size);
    maxCircle(ctx, radius, a, o.k);
    deadSquare(ctx, d, a, o.k);
    offsetStick(ctx, ox, oy, a, o.k, size);
    speedArrow(ctx, tip.x, tip.y, a, o.k, o.colors.accent, size);
    dot(ctx, 0, 0, Math.max(2.6, 0.06 * size), a, o.k);
    ctx.restore();
}
