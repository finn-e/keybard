import type { Appearance } from './core';

/**
 * Adaptive contrast: Keybard Host samples the screen under the overlay and
 * sends a coarse brightness grid. The grid includes the overlay itself (it stays in
 * screenshots), so each key reads the background from the uncovered cells around it,
 * between and beside the keys, and picks legend and backing colors that stand out.
 */
export interface Backdrop {
    /** Grid size in cells; cells evenly cover the overlay window. */
    cols: number;
    rows: number;
    /** Base64 of cols * rows bytes, row by row: perceived brightness 0-255 of each cell. */
    lum: string;
    /** Same layout: fine detail in each cell, the mean difference of its pixels from the blurred background
     *  (text and icons score high even when a cell's average brightness matches its neighbours'). */
    detail?: string;
    /** Window rects [x, y, w, h] whose pixels aren't background (off screen, under the Host's controls). */
    mask?: number[][];
}

/** A key's background: brightness mean, spread between cells, and the cells' mean fine detail. */
export interface KeyBackdrop { mean: number; spread: number; detail: number }

const DARK = '#111417', LIGHT = '#f5f7f8';

export function decodeBackdrop(b: Backdrop, field: 'lum' | 'detail' = 'lum'): Uint8Array {
    const raw = atob(b[field] ?? '');
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
}

export interface Rect { left: number; top: number; width: number; height: number }

/** How fast a cell's weight falls off with distance from the key, in key sizes (weight 1/e at this distance). */
const NEAR = .3;

/** Pixels past a key's edge that its outline and halo cover at the default size; the page passes the real figure. */
export const KEY_PAD = 4;

function cellRange(b: Backdrop, width: number, height: number, rect: Rect, pad: number) {
    const cw = width / b.cols, ch = height / b.rows;
    return {
        c0: Math.max(0, Math.floor((rect.left - pad) / cw)), c1: Math.min(b.cols - 1, Math.floor((rect.left + rect.width + pad) / cw)),
        r0: Math.max(0, Math.floor((rect.top - pad) / ch)), r1: Math.min(b.rows - 1, Math.floor((rect.top + rect.height + pad) / ch)),
    };
}

/**
 * Cells whose brightness isn't the background's: those the overlay draws on (each key, padded
 * by how far its outline and halo reach) and those the Host masks (off screen, under its controls).
 */
export function coveredCells(b: Backdrop, width: number, height: number, keys: Rect[], pad = KEY_PAD): Uint8Array {
    const covered = new Uint8Array(b.cols * b.rows);
    const cover = (rect: Rect, by: number) => {
        const { c0, c1, r0, r1 } = cellRange(b, width, height, rect, by);
        for (let r = r0; r <= r1; r++) covered.fill(1, r * b.cols + c0, r * b.cols + c1 + 1);
    };
    for (const rect of keys) cover(rect, pad);
    for (const [left, top, w, h] of b.mask ?? []) if (w > 0 && h > 0) cover({ left, top, width: w, height: h }, 0);
    return covered;
}

/**
 * The background around a key, from the uncovered cells within a key's width of it
 * (widening once if the key sits deep inside a cluster). Nearer cells count more, so a
 * key mostly over one of two windows goes with that window: weighted brightness mean
 * and spread, and the cells' weighted fine detail.
 */
export function sampleAround(lum: Uint8Array, covered: Uint8Array, b: Backdrop, width: number, height: number, rect: Rect,
    detail?: Uint8Array): KeyBackdrop | null {
    const reach = Math.max(rect.width, rect.height);
    for (const margin of [reach * .75, reach * 1.75]) {
        const { c0, c1, r0, r1 } = cellRange(b, width, height, rect, margin);
        const cw = width / b.cols, ch = height / b.rows;
        let n = 0, total = 0, sum = 0, sq = 0, fine = 0;
        for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
            const i = r * b.cols + c;
            if (covered[i]) continue;
            // Distance from the cell's center to the key's edge, in key sizes.
            const x = (c + .5) * cw, y = (r + .5) * ch;
            const dx = Math.max(rect.left - x, 0, x - rect.left - rect.width), dy = Math.max(rect.top - y, 0, y - rect.top - rect.height);
            const w = Math.exp(-Math.hypot(dx, dy) / (reach * NEAR));
            const v = lum[i]; n++; total += w; sum += w * v; sq += w * v * v; fine += w * (detail?.[i] ?? 0);
        }
        if (n >= 4 && total > 0) {
            const mean = sum / total;
            return { mean, spread: Math.sqrt(Math.max(0, sq / total - mean * mean)), detail: fine / total };
        }
    }
    return null;
}

/** Whether a key shows dark legends, with hysteresis so keys near the middle don't flicker. */
export function wantsDarkLegend(mean: number, previous: boolean | undefined): boolean {
    if (previous === undefined) return mean > 140;
    return previous ? mean > 125 : mean > 155;
}

/**
 * How busy a backdrop is, 0 (flat) to 1 (very busy). Mostly fine detail such as text and
 * texture; broad brightness changes count only a little, since one edge between two flat
 * windows isn't busy (the legend color handles it).
 */
export function busyness(backdrop: Pick<KeyBackdrop, 'spread' | 'detail'>): number {
    const score = SPREAD_WEIGHT * backdrop.spread + DETAIL_WEIGHT * backdrop.detail;
    return Math.max(0, Math.min(1, (score - BUSY_FROM) / (BUSY_FULL - BUSY_FROM)));
}
/** Score at which a backdrop starts to count as busy, and at which it's fully busy; how much each input counts. */
const BUSY_FROM = 6, BUSY_FULL = 50, DETAIL_WEIGHT = 2, SPREAD_WEIGHT = .2;
/** Backing-plate opacity (%) on a flat backdrop at least, and on a fully busy one. */
const PLATE_MIN = 12, PLATE_MAX = 90;

/**
 * The key's appearance over its backdrop: legends against the background, and a backing
 * plate whose opacity rises with how busy the background is, so a busy one is covered
 * up rather than only recolored.
 */
export function adaptAppearance(base: Appearance, t: number, dark: boolean): Appearance {
    const ink = dark ? DARK : LIGHT, plate = dark ? LIGHT : DARK;
    const lerp = (from: number, to: number) => Math.round(from + (to - from) * t);
    return {
        ...base,
        legend: ink, legendAlpha: 100,
        outline: ink, outlineAlpha: lerp(Math.max(base.outlineAlpha, 70), 100),
        fill: plate,
        fillAlpha: lerp(Math.max(base.fillAlpha, PLATE_MIN), PLATE_MAX),
        halo: true,
    };
}

export interface AdaptedKey { id: number; sample: KeyBackdrop; busy: number; dark: boolean; appearance: Appearance }

/** One backdrop update: each key's legend and plate opacity follow the background around that key. */
export function adaptKeys(backdrop: Backdrop, width: number, height: number, keys: Array<{ id: number; rect: Rect }>,
    base: Appearance, previousDark: Map<number, boolean>, pad = KEY_PAD): AdaptedKey[] {
    const lum = decodeBackdrop(backdrop), detail = backdrop.detail ? decodeBackdrop(backdrop, 'detail') : undefined;
    const covered = coveredCells(backdrop, width, height, keys.map(k => k.rect), pad);
    const out: AdaptedKey[] = [];
    for (const { id, rect } of keys) {
        const sample = sampleAround(lum, covered, backdrop, width, height, rect, detail);
        if (!sample) continue;
        const busy = busyness(sample), dark = wantsDarkLegend(sample.mean, previousDark.get(id));
        out.push({ id, sample, busy, dark, appearance: adaptAppearance(base, busy, dark) });
    }
    return out;
}

/**
 * How far past a key's rect its drawing reaches, in window pixels: half the outline and its halo
 * stroke (a.width + 2 units wide) at the overlay's scale, plus a grid cell for the grab's blur.
 */
export function keyPad(outlineWidth: number, unitsToPixels: number, cell: number): number {
    return Math.ceil(((outlineWidth + 2) / 2) * unitsToPixels) + cell;
}
