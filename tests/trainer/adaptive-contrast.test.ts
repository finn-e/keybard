import { describe, expect, it } from 'vitest';
import { adaptAppearance, adaptKeys, busyness, coveredCells, decodeBackdrop, sampleAround, wantsDarkLegend, type Backdrop } from '@/features/trainer/adaptiveContrast';
import { DEFAULTS } from '@/features/trainer/core';

/**
 * The overlay draped over two windows: a 60 x 18 grid of 4 px cells over a 240 x 72 px
 * window, dark on the left half and light on the right. The overlay's own keys show in
 * the grab (it isn't hidden from capture) as bright outlines on top.
 */
const KEYS = [{ left: 20, top: 20, width: 32, height: 32 }, { left: 180, top: 20, width: 32, height: 32 }, { left: 104, top: 20, width: 32, height: 32 }];
function twoWindows(): Backdrop {
    const cells = Array.from({ length: 18 * 60 }, (_, i) => (i % 60 < 30 ? 16 : 240));
    // Paint each key's cells bright, as the overlay's outline and legend would show in the grab.
    for (const k of KEYS) for (let r = k.top / 4; r < (k.top + k.height) / 4; r++) for (let c = k.left / 4; c < (k.left + k.width) / 4; c++) cells[r * 60 + c] = 255;
    return { cols: 60, rows: 18, lum: btoa(String.fromCharCode(...cells)) };
}

describe('adaptive contrast', () => {
    it('reads each key against the background around it, not the overlay it draws', () => {
        const b = twoWindows(), lum = decodeBackdrop(b), covered = coveredCells(b, 240, 72, KEYS);
        const left = sampleAround(lum, covered, b, 240, 72, KEYS[0])!;
        const right = sampleAround(lum, covered, b, 240, 72, KEYS[1])!;
        expect(left.mean).toBeCloseTo(16);
        expect(left.spread).toBeCloseTo(0);
        expect(right.mean).toBeCloseTo(240);
        // A key on the boundary between the two windows sees both, nearer cells counting more.
        expect(sampleAround(lum, covered, b, 240, 72, KEYS[2])!.spread).toBeGreaterThan(80);
    });

    it('goes with the window a key is mostly over', () => {
        const b = twoWindows(), lum = decodeBackdrop(b);
        // Mostly over the light window, just past the dark one's edge (x = 120).
        const key = { left: 112, top: 20, width: 32, height: 32 };
        const sample = sampleAround(lum, coveredCells(b, 240, 72, [key]), b, 240, 72, key)!;
        expect(sample.mean).toBeGreaterThan(140);
        expect(wantsDarkLegend(sample.mean, undefined)).toBe(true);
    });

    it('marks the cells under keys and their outlines as covered', () => {
        const b = twoWindows(), covered = coveredCells(b, 240, 72, [KEYS[0]]);
        expect(covered[(32 / 4) * 60 + 32 / 4]).toBe(1);
        expect(covered[(32 / 4) * 60 + 30]).toBe(0);
    });

    it('uses dark legends on light backgrounds and light ones on dark, with hysteresis', () => {
        expect(wantsDarkLegend(240, undefined)).toBe(true);
        expect(wantsDarkLegend(16, undefined)).toBe(false);
        expect(wantsDarkLegend(140, true)).toBe(true);
        expect(wantsDarkLegend(140, false)).toBe(false);
        expect(wantsDarkLegend(160, false)).toBe(true);
    });

    it('raises the plate opacity steadily with how busy the background is', () => {
        const alphas = [0, 5, 10, 15, 20, 25, 40].map(detail => adaptAppearance(DEFAULTS.appearance, busyness({ spread: 0, detail }), false).fillAlpha);
        for (let i = 1; i < alphas.length; i++) expect(alphas[i]).toBeGreaterThanOrEqual(alphas[i - 1]);
        expect(alphas[0]).toBeLessThanOrEqual(20);
        expect(alphas.at(-1)).toBe(90);
        expect(busyness({ spread: 0, detail: 0 })).toBe(0);
        expect(busyness({ spread: 0, detail: 40 })).toBe(1);
        // One sharp edge between two flat windows is not busy.
        expect(busyness({ spread: 113, detail: 2 })).toBeLessThan(.5);
        // Fine detail such as text counts even when the brightness hardly varies between cells.
        expect(busyness({ spread: 2, detail: 20 })).toBeGreaterThan(busyness({ spread: 2, detail: 0 }));
    });

    it('backs a busy background with a firmer plate than a calm one', () => {
        const calm = adaptAppearance(DEFAULTS.appearance, busyness({ spread: 4, detail: 0 }), false);
        const busy = adaptAppearance(DEFAULTS.appearance, busyness({ spread: 10, detail: 30 }), false);
        expect(calm.legend).toBe('#f5f7f8');
        expect(calm.fill).toBe('#111417');
        expect(busy.fillAlpha).toBeGreaterThan(calm.fillAlpha);
        expect(busy.halo).toBe(true);
        // Feedback colors stay the user's.
        expect(busy.pressed).toBe(DEFAULTS.appearance.pressed);
    });

    it('gives each key its own opacity: one over text gets a firmer plate than one over a flat area', () => {
        const cells = new Array(18 * 60).fill(30), detail = new Array(18 * 60).fill(0);
        for (let i = 0; i < cells.length; i++) if (i % 60 >= 30) detail[i] = 25; // text on the right half
        const b: Backdrop = { cols: 60, rows: 18, lum: btoa(String.fromCharCode(...cells)), detail: btoa(String.fromCharCode(...detail)) };
        const [flat, text] = adaptKeys(b, 240, 72, [{ id: 1, rect: KEYS[0] }, { id: 2, rect: KEYS[1] }], DEFAULTS.appearance, new Map());
        expect(text.appearance.fillAlpha).toBeGreaterThan(flat.appearance.fillAlpha + 20);
    });
});
