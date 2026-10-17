// Folded corner: which of a key's combos are drawn, in which spot, and the fold's geometry.
// Pure functions, so the order rules can be tested without a DOM.
//
// Order rule. Combos have one global order, their combo number. On a key, its combos are
// drawn sorted by that number, so two combos always appear in the same relative order on
// every key they share. Position is rank on the key, not a fixed slot per combo:
//   - one combo fills the whole corner;
//   - two split it, in order 1, 2;
//   - three: the first two take the first two spots and the third takes the last spot.
// Spots run from the key's horizontal edge (bottom, or top when the fold flips to the top
// corner) toward its vertical right edge.
//
// More than three: the lowest three by combo number are drawn and nothing else marks the rest;
// the preview readout and the Combos list name them all. While a preview is up, a member key
// draws only the previewed combos (same order, same cap), so a previewed combo always shows on
// its keys.
import type { ComboMembership } from "./combo-membership";

export const FOLD_CAP = 3;

export type KeySize = "default" | "medium" | "small";

export interface FoldLayout {
    /** Combos drawn, in spot order (ascending combo number). */
    shown: ComboMembership[];
}

/** The combos a key draws. `focus` is the previewed combo set, if this key is a member of it. */
export function foldLayout(
    memberships: readonly ComboMembership[],
    opts: { cap?: number; focus?: ReadonlySet<number> | null } = {},
): FoldLayout {
    const cap = opts.cap ?? FOLD_CAP;
    const sorted = [...memberships].sort((a, b) => a.index - b.index);
    const focus = opts.focus;
    const list = focus && sorted.some(m => focus.has(m.index)) ? sorted.filter(m => focus.has(m.index)) : sorted;
    return { shown: list.slice(0, cap) };
}

/** Combos of a key that its fold does not draw (past the cap, by combo number). */
export function hiddenOnKey(memberships: readonly ComboMembership[], cap = FOLD_CAP): Set<number> {
    return new Set([...memberships].sort((a, b) => a.index - b.index).slice(cap).map(m => m.index));
}

// Compact fold leg (px, along each key edge, excluding the crease) per key size.
export const LEG: Record<KeySize, number> = { default: 18, medium: 13, small: 10 };
export const MIN_LEG: Record<KeySize, number> = { default: 12, medium: 7, small: 5 };
export const CREASE: Record<KeySize, number> = { default: 1.25, medium: 1, small: 1 };
export const SEAM: Record<KeySize, number> = { default: 1, medium: 1, small: 0.75 };
/** Minimum gap between the fold and any legend glyph (compact size). */
export const CLEAR = 1.5;
/** The large fold: legs 1.7 times the compact size. */
export const LARGE_SCALE = 1.7;
/** Strokes and the legend gap grow more slowly than the legs, so they stay crisp. */
const STROKE_GROWTH = 0.6;

export interface FoldGeometry {
    /** Fold leg, crease excluded. */
    L: number;
    crease: number;
    seam: number;
    /** Gap kept from legends. */
    clear: number;
    /** SVG box side; the key's corner is at (box, box). */
    box: number;
}

/** Sizes for a fold at `scale` (1 compact, LARGE_SCALE large) with `room` px (crease included) before it would touch a legend. */
export function foldGeometry(size: KeySize, room: number, scale = 1): FoldGeometry {
    const grow = 1 + (scale - 1) * STROKE_GROWTH;
    const crease = CREASE[size] * grow;
    const seam = SEAM[size] * grow;
    const clear = CLEAR * grow;
    const L = Math.max(MIN_LEG[size], Math.min(LEG[size] * scale, room - crease - clear));
    const box = Math.ceil(L + crease + 1);
    return { L, crease, seam, clear, box };
}

/** Room the smallest large fold needs; below this the key's legend shrinks (see fitLegend). */
export const minRoom = (size: KeySize, scale = LARGE_SCALE) => {
    const g = foldGeometry(size, 0, scale);
    return MIN_LEG[size] + g.crease + g.clear;
};

/**
 * Compact size as a fraction of the large fold (both measured to the crease's outer edge),
 * for scaling the large drawing toward the key corner at rest. Never above 1: on a crowded
 * key the large fold is the one that keeps clear of the legend.
 */
export function restScale(size: KeySize, room: number): number {
    const big = foldGeometry(size, room, LARGE_SCALE);
    const small = foldGeometry(size, room, 1);
    return Math.min(1, (small.L + small.crease) / (big.L + big.crease));
}

/** Legend shrink steps: 95%, 90%, ... down to 80%. */
export const LEGEND_STEPS = [0.95, 0.9, 0.85, 0.8];

/** Texture period (px in the drawing) for the colorblind texture cue. */
export const texturePeriod = (size: KeySize, scale = LARGE_SCALE) =>
    (size === "small" ? 2.4 : size === "medium" ? 2.8 : 3.2) * (1 + (scale - 1) * 0.4);

export interface Pt { x: number; y: number }

/**
 * The n pieces of a cut fold, in spot order. Each piece is a triangle from the key's corner
 * (padded 2px past the key edges) to two equal divisions of the fold edge, so every piece
 * meets the crease at the same width. Spot 0 touches the bottom edge, spot n-1 the right edge.
 */
export function foldPieces(C: number, L: number, n: number): Pt[][] {
    const P = (t: number): Pt => ({ x: C - L + L * t, y: C - L * t });
    return Array.from({ length: n }, (_, i) => [{ x: C + 2, y: C + 2 }, P(i / n), P((i + 1) / n)]);
}

/** Seams between pieces: lines from the corner to each inner division of the fold edge. */
export function foldSeams(C: number, L: number, n: number): Array<[Pt, Pt]> {
    return Array.from({ length: Math.max(0, n - 1) }, (_, k) => {
        const t = (k + 1) / n;
        return [{ x: C + 1, y: C + 1 }, { x: C - L + L * t, y: C - L * t }];
    });
}

/** The strip between two folds (the crease), drawn without overlap. */
export function foldStrip(C: number, inner: number, outer: number): string {
    return `M${C - outer},${C + 2} L${C - outer},${C} L${C},${C - outer} L${C + 2},${C - outer} L${C + 2},${C - inner} L${C},${C - inner} L${C - inner},${C} L${C - inner},${C + 2} Z`;
}

export const pointsAttr = (pts: Pt[]) => pts.map(p => `${p.x},${p.y}`).join(" ");
