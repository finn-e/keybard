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
// More than three: the lowest three by combo number are drawn, plus a second sheet peeking
// out behind the fold. While a preview is up, a member key draws only the previewed combos
// (same order, same cap), so a previewed combo always shows on its keys.
import type { ComboMembership } from "./combo-membership";

export const FOLD_CAP = 3;

export type KeySize = "default" | "medium" | "small";

export interface FoldLayout {
    /** Combos drawn, in spot order (ascending combo number). */
    shown: ComboMembership[];
    /** More combos than the cap: draw the second sheet. */
    overflow: boolean;
}

/** The combos a key draws and whether it overflows. `focus` is the previewed combo set, if this key is a member of it. */
export function foldLayout(
    memberships: readonly ComboMembership[],
    opts: { cap?: number; focus?: ReadonlySet<number> | null } = {},
): FoldLayout {
    const cap = opts.cap ?? FOLD_CAP;
    const sorted = [...memberships].sort((a, b) => a.index - b.index);
    const focus = opts.focus;
    const list = focus && sorted.some(m => focus.has(m.index)) ? sorted.filter(m => focus.has(m.index)) : sorted;
    return { shown: list.slice(0, cap), overflow: list.length > cap };
}

// Fold leg (px, along each key edge, excluding the crease) per key size.
export const LEG: Record<KeySize, number> = { default: 18, medium: 13, small: 10 };
/** While a combo is previewed, its member keys lift a larger fold (still clear of legends). */
export const FOCUS_LEG: Record<KeySize, number> = { default: 24, medium: 17, small: 12 };
export const MIN_LEG: Record<KeySize, number> = { default: 12, medium: 7, small: 5 };
export const CREASE: Record<KeySize, number> = { default: 1.25, medium: 1, small: 1 };
/** Overflow: a second sheet behind the fold, closed by its own crease. */
export const SHEET: Record<KeySize, number> = { default: 2.5, medium: 2, small: 1.5 };
export const SHEET_EDGE: Record<KeySize, number> = { default: 1, medium: 1, small: 0.75 };
/** Minimum gap between the fold and any legend glyph. */
export const CLEAR = 1.5;

export interface FoldGeometry {
    /** Fold leg, crease excluded. */
    L: number;
    crease: number;
    /** Pale part of the second sheet (0 without overflow). */
    sheetPale: number;
    /** Whole second sheet, its crease included (0 without overflow). */
    sheet: number;
    /** SVG box side; the key's corner is at (box, box). */
    box: number;
}

/** Sizes for a fold that has `room` px (crease included) before it would touch a legend. */
export function foldGeometry(size: KeySize, room: number, focused: boolean, overflow: boolean): FoldGeometry {
    const crease = CREASE[size];
    // On crowded keys the overflow sheet narrows before the fold drops below its minimum.
    const sheetPale = overflow ? Math.max(0.5, Math.min(SHEET[size], room - crease - CLEAR - MIN_LEG[size] - SHEET_EDGE[size])) : 0;
    const sheet = overflow ? sheetPale + SHEET_EDGE[size] : 0;
    const L = Math.max(MIN_LEG[size], Math.min(focused ? FOCUS_LEG[size] : LEG[size], room - crease - sheet - CLEAR));
    const box = Math.ceil(L + crease + sheet + 1);
    return { L, crease, sheetPale, sheet, box };
}

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

/** The strip between two folds (crease, sheet), drawn without overlap. */
export function foldStrip(C: number, inner: number, outer: number): string {
    return `M${C - outer},${C + 2} L${C - outer},${C} L${C},${C - outer} L${C + 2},${C - outer} L${C + 2},${C - inner} L${C},${C - inner} L${C - inner},${C} L${C - inner},${C + 2} Z`;
}

export const pointsAttr = (pts: Pt[]) => pts.map(p => `${p.x},${p.y}`).join(" ");
