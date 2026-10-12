import type { Appearance } from './core';

/**
 * Adaptive contrast (prototype): Keybard Host samples the screen under the overlay and
 * sends a coarse brightness grid. The grid includes the overlay itself (it stays in
 * screenshots), so each key reads the background from the uncovered cells around it,
 * between and beside the keys, and picks legend and backing colours that stand out.
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

/** Pixels past a key's edge that its outline and halo can still cover. */
const KEY_PAD = 4;

function cellRange(b: Backdrop, width: number, height: number, rect: Rect, pad: number) {
    const cw = width / b.cols, ch = height / b.rows;
    return {
        c0: Math.max(0, Math.floor((rect.left - pad) / cw)), c1: Math.min(b.cols - 1, Math.floor((rect.left + rect.width + pad) / cw)),
        r0: Math.max(0, Math.floor((rect.top - pad) / ch)), r1: Math.min(b.rows - 1, Math.floor((rect.top + rect.height + pad) / ch)),
    };
}

/** Cells the overlay draws on (any key, with its outline): their brightness is the overlay's, not the background's. */
export function coveredCells(b: Backdrop, width: number, height: number, keys: Rect[]): Uint8Array {
    const covered = new Uint8Array(b.cols * b.rows);
    for (const rect of keys) {
        const { c0, c1, r0, r1 } = cellRange(b, width, height, rect, KEY_PAD);
        for (let r = r0; r <= r1; r++) covered.fill(1, r * b.cols + c0, r * b.cols + c1 + 1);
    }
    return covered;
}

/**
 * The background around a key: brightness mean and standard deviation of the uncovered
 * cells within a key's width of it, widening once if the key sits deep inside a cluster.
 */
export function sampleAround(lum: Uint8Array, covered: Uint8Array, b: Backdrop, width: number, height: number, rect: Rect,
    detail?: Uint8Array): KeyBackdrop | null {
    const reach = Math.max(rect.width, rect.height);
    for (const margin of [reach * .75, reach * 1.75]) {
        const { c0, c1, r0, r1 } = cellRange(b, width, height, rect, margin);
        let n = 0, sum = 0, sq = 0, fine = 0;
        for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
            const i = r * b.cols + c;
            if (covered[i]) continue;
            const v = lum[i]; n++; sum += v; sq += v * v; fine += detail?.[i] ?? 0;
        }
        if (n >= 4) {
            const mean = sum / n;
            return { mean, spread: Math.sqrt(Math.max(0, sq / n - mean * mean)), detail: fine / n };
        }
    }
    return null;
}

/** Whether a key shows dark legends, with hysteresis so keys near the middle don't flicker. */
export function wantsDarkLegend(mean: number, previous: boolean | undefined): boolean {
    if (previous === undefined) return mean > 140;
    return previous ? mean > 115 : mean > 165;
}

/** How busy a backdrop is, 0 (flat) to 1 (very busy): brightness changes between cells plus fine detail such as text. */
export function busyness(backdrop: Pick<KeyBackdrop, 'spread' | 'detail'>): number {
    const score = backdrop.spread + DETAIL_WEIGHT * backdrop.detail;
    return Math.max(0, Math.min(1, (score - BUSY_FROM) / (BUSY_FULL - BUSY_FROM)));
}
/** Score at which a backdrop starts to count as busy, and at which it's fully busy; how much fine detail counts. */
const BUSY_FROM = 6, BUSY_FULL = 50, DETAIL_WEIGHT = 2;
/** Backing-plate opacity (%) on a flat backdrop at least, and on a fully busy one. */
const PLATE_MIN = 12, PLATE_MAX = 90;

/**
 * The key's appearance over its backdrop: legends against the background, and a backing
 * plate whose opacity rises with how busy the background is, so a busy one is covered
 * up rather than only recoloured.
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
    base: Appearance, previousDark: Map<number, boolean>): AdaptedKey[] {
    const lum = decodeBackdrop(backdrop), detail = backdrop.detail ? decodeBackdrop(backdrop, 'detail') : undefined;
    const covered = coveredCells(backdrop, width, height, keys.map(k => k.rect));
    const out: AdaptedKey[] = [];
    for (const { id, rect } of keys) {
        const sample = sampleAround(lum, covered, backdrop, width, height, rect, detail);
        if (!sample) continue;
        const busy = busyness(sample), dark = wantsDarkLegend(sample.mean, previousDark.get(id));
        out.push({ id, sample, busy, dark, appearance: adaptAppearance(base, busy, dark) });
    }
    return out;
}
