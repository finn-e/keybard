// Where each hand's pointing device sits, at true size, in key units. The
// devices fill the free space under the ring and middle clusters beside the
// thumbs; nothing here needs the board's pointing instances, only the keys.
// Ported from the round 5 design prototype (freeCircle / freeRect).

import { BALLS, TOUCHPAD_MM, type BallId } from "@/components/pointing-viz/webgl/materials";

/** Millimeters per key unit on the Svalboard (key pitch). */
export const MM_PER_U = 11.58;
/** Clearance kept between a device and any key, in key units. */
export const MARGIN = 0.15;
/** The drawn square around a ball, as a multiple of its radius (room for its shadow). */
export const BALL_VIEW = 1.24;

export interface KeyRect { x: number; y: number; w: number; h: number }
export type Side = "left" | "right";
export interface FreeCircle { cx: number; cy: number; r: number }

function rectDist(px: number, py: number, k: KeyRect) {
    const dx = Math.max(k.x - px, 0, px - (k.x + k.w));
    const dy = Math.max(k.y - py, 0, py - (k.y + k.h));
    return Math.hypot(dx, dy);
}

function bounds(keys: KeyRect[]) {
    let minX = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const k of keys) { minX = Math.min(minX, k.x); maxX = Math.max(maxX, k.x + k.w); maxY = Math.max(maxY, k.y + k.h); }
    return { minX, maxX, maxY, mid: (minX + maxX) / 2 };
}

/** The largest circle clear of every key on that side, below the top rows and above maxY. */
export function freeCircle(keys: KeyRect[], side: Side, maxY?: number): FreeCircle | null {
    if (!keys.length) return null;
    const b = bounds(keys);
    const bottom = maxY ?? b.maxY;
    const xs = side === "left" ? [b.minX + 1.5, b.mid - 1] : [b.mid, b.maxX - 1.5];
    let best: FreeCircle = { cx: 0, cy: 0, r: 0 };
    const scan = (x0: number, x1: number, y0: number, y1: number, step: number) => {
        for (let x = x0; x <= x1 + 1e-9; x += step) for (let y = y0; y <= y1 + 1e-9; y += step) {
            let r = bottom - y;
            for (const k of keys) { r = Math.min(r, rectDist(x, y, k) - MARGIN); if (r <= best.r) break; }
            if (r > best.r) best = { cx: x, cy: y, r };
        }
    };
    scan(xs[0], xs[1], 2.5, bottom - 0.5, 0.1);
    if (best.r <= 0) return null;
    const c = best;
    scan(c.cx - 0.15, c.cx + 0.15, c.cy - 0.15, c.cy + 0.15, 0.005);
    return best;
}

/** The largest rectangle of the given aspect (w / h), at most `cap` tall, near the free circle. */
export function freeRect(keys: KeyRect[], side: Side, aspect: number, cap: number, maxY?: number) {
    const fc = freeCircle(keys, side, maxY);
    if (!fc) return null;
    const bottom = maxY ?? bounds(keys).maxY;
    const fits = (cx: number, cy: number, hw: number, hh: number) => {
        if (cy + hh > bottom) return false;
        for (const k of keys) if (cx + hw + MARGIN > k.x && cx - hw - MARGIN < k.x + k.w && cy + hh + MARGIN > k.y && cy - hh - MARGIN < k.y + k.h) return false;
        return true;
    };
    let best = { s: 0, cx: fc.cx, cy: fc.cy, h: 0 };
    for (let dx = -0.4; dx <= 0.401; dx += 0.04) for (let dy = -0.4; dy <= 0.401; dy += 0.04) {
        const x = fc.cx + dx, y = fc.cy + dy;
        let lo = 0, hi = cap;
        for (let i = 0; i < 16; i++) { const m = (lo + hi) / 2; if (fits(x, y, m * aspect / 2, m / 2)) lo = m; else hi = m; }
        const score = lo - 0.02 * Math.hypot(dx, dy);
        if (score > best.s) best = { cx: x, cy: y, s: score, h: lo };
    }
    return { cx: best.cx, cy: best.cy, w: best.h * aspect, h: best.h };
}

/** A device placed in key units: its center, the drawn square's size, and its true outline. */
export interface DevicePlacement {
    kind: "ball" | "pad";
    side: Side;
    cx: number;
    cy: number;
    /** Ball or pad size in key units (ball diameter; pad's larger side). */
    dU: number;
    /** The drawn square's side, in key units. */
    sizeU: number;
    /** Half-extent of the drawn square in device units (ball radius 1; pad glass w x h). */
    view: number;
    /** Touchpad glass size and corner, in device units (pad only). */
    w?: number;
    h?: number;
    corner?: number;
}

/** Places one hand's device, or null when there is no room. */
export function placeDevice(keys: KeyRect[], side: Side, kind: "ball" | "pad", ball: BallId = "silver", maxY?: number): DevicePlacement | null {
    if (kind === "ball") {
        const fc = freeCircle(keys, side, maxY);
        if (!fc) return null;
        const dU = Math.min(BALLS[ball].mm / MM_PER_U, fc.r * 2);
        return { kind, side, cx: fc.cx, cy: fc.cy, dU, sizeU: dU * BALL_VIEW, view: BALL_VIEW };
    }
    const W = TOUCHPAD_MM.w / MM_PER_U, H = TOUCHPAD_MM.h / MM_PER_U;
    const fr = freeRect(keys, side, W / H, H, maxY);
    if (!fr || fr.h <= 0) return null;
    const s = Math.min(1, fr.h / H);
    const ext = Math.max(W, H) * s * 1.18;
    // the shader's units: the drawn square spans [-view, view]; the glass is w x h in the same units
    return { kind, side, cx: fr.cx, cy: fr.cy, dU: Math.max(W, H) * s, sizeU: ext, view: ext / 2, w: W * s, h: H * s, corner: 0.26 * s };
}

/**
 * Key rects as Keyboard.tsx draws them (finger-cluster squeeze and the global
 * offset applied), so the devices follow the keys.
 */
export function placedKeyRects(
    keys: KeyRect[],
    o: { getYPos: (y: number) => number; squeeze: number; midline: number; offsetX: number; offsetY: number },
): KeyRect[] {
    return keys.map((k) => {
        let x = k.x;
        if (o.squeeze > 0) {
            if (k.y < 5) x = k.x + (k.x + k.w / 2 < o.midline ? o.squeeze : -o.squeeze);
            x -= o.squeeze;
        }
        return { x: x + o.offsetX, y: o.getYPos(k.y) + o.offsetY, w: k.w, h: k.h };
    });
}
