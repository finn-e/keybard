import type { Appearance } from './core';

/**
 * Adaptive contrast (prototype): Keybard Host samples the screen behind the overlay
 * and sends a coarse brightness grid; each key then picks legend and backing colours
 * that stand out against whatever is behind that key.
 */
export interface Backdrop {
    /** Grid size in cells; cells evenly cover the overlay window. */
    cols: number;
    rows: number;
    /** Base64 of cols * rows bytes, row by row: perceived brightness 0-255 of each cell. */
    lum: string;
}

export interface KeyBackdrop { mean: number; spread: number }

const DARK = '#111417', LIGHT = '#f5f7f8';

export function decodeBackdrop(b: Backdrop): Uint8Array {
    const raw = atob(b.lum);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
}

/** Brightness mean and standard deviation of the cells under a rect, in window pixels. */
export function sampleRect(lum: Uint8Array, b: Backdrop, width: number, height: number,
    rect: { left: number; top: number; width: number; height: number }): KeyBackdrop | null {
    const cw = width / b.cols, ch = height / b.rows;
    const c0 = Math.max(0, Math.floor(rect.left / cw)), c1 = Math.min(b.cols - 1, Math.floor((rect.left + rect.width) / cw));
    const r0 = Math.max(0, Math.floor(rect.top / ch)), r1 = Math.min(b.rows - 1, Math.floor((rect.top + rect.height) / ch));
    let n = 0, sum = 0, sq = 0;
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        const v = lum[r * b.cols + c]; n++; sum += v; sq += v * v;
    }
    if (!n) return null;
    const mean = sum / n;
    return { mean, spread: Math.sqrt(Math.max(0, sq / n - mean * mean)) };
}

/** Whether a key shows dark legends, with hysteresis so keys near the middle don't flicker. */
export function wantsDarkLegend(mean: number, previous: boolean | undefined): boolean {
    if (previous === undefined) return mean > 140;
    return previous ? mean > 115 : mean > 165;
}

/** The key's appearance over its backdrop: legends against the background, a firmer plate when it's busy. */
export function adaptAppearance(base: Appearance, backdrop: KeyBackdrop, dark: boolean): Appearance {
    const ink = dark ? DARK : LIGHT, plate = dark ? LIGHT : DARK;
    const busy = backdrop.spread > 28;
    return {
        ...base,
        legend: ink, legendAlpha: 100,
        outline: ink, outlineAlpha: Math.max(base.outlineAlpha, 70),
        fill: plate,
        // A calm background needs only a light plate; a busy one gets a firmer one.
        fillAlpha: busy ? Math.round(Math.min(85, 40 + backdrop.spread)) : Math.max(base.fillAlpha, 15),
        halo: true,
    };
}
