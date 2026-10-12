import { describe, expect, it } from 'vitest';
import { adaptAppearance, busyness, coveredCells, decodeBackdrop, sampleAround, wantsDarkLegend, type Backdrop } from '@/features/trainer/adaptiveContrast';
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
        expect(left.mean).toBe(16);
        expect(left.spread).toBe(0);
        expect(right.mean).toBe(240);
        // A key on the boundary between the two windows sees a busy background.
        expect(sampleAround(lum, covered, b, 240, 72, KEYS[2])!.spread).toBeGreaterThan(100);
    });

    it('marks the cells under keys and their outlines as covered', () => {
        const b = twoWindows(), covered = coveredCells(b, 240, 72, [KEYS[0]]);
        expect(covered[(32 / 4) * 60 + 32 / 4]).toBe(1);
        expect(covered[(32 / 4) * 60 + 30]).toBe(0);
    });

    it('uses dark legends on light backgrounds and light ones on dark, with hysteresis', () => {
        expect(wantsDarkLegend(240, undefined)).toBe(true);
        expect(wantsDarkLegend(16, undefined)).toBe(false);
        expect(wantsDarkLegend(130, true)).toBe(true);
        expect(wantsDarkLegend(130, false)).toBe(false);
    });

    it('raises the plate opacity steadily with how busy the background is', () => {
        const alphas = [0, 10, 20, 30, 40, 50, 80].map(spread => adaptAppearance(DEFAULTS.appearance, { mean: 120, spread }, false).fillAlpha);
        for (let i = 1; i < alphas.length; i++) expect(alphas[i]).toBeGreaterThanOrEqual(alphas[i - 1]);
        expect(alphas[0]).toBeLessThanOrEqual(20);
        expect(alphas.at(-1)).toBe(90);
        expect(busyness(0)).toBe(0);
        expect(busyness(200)).toBe(1);
    });

    it('backs a busy background with a firmer plate than a calm one', () => {
        const calm = adaptAppearance(DEFAULTS.appearance, { mean: 16, spread: 4 }, false);
        const busy = adaptAppearance(DEFAULTS.appearance, { mean: 120, spread: 60 }, false);
        expect(calm.legend).toBe('#f5f7f8');
        expect(calm.fill).toBe('#111417');
        expect(busy.fillAlpha).toBeGreaterThan(calm.fillAlpha);
        expect(busy.halo).toBe(true);
        // Feedback colours stay the user's.
        expect(busy.pressed).toBe(DEFAULTS.appearance.pressed);
    });
});
