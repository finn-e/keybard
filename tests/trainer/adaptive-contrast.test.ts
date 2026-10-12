import { describe, expect, it } from 'vitest';
import { adaptAppearance, decodeBackdrop, sampleRect, wantsDarkLegend, type Backdrop } from '@/features/trainer/adaptiveContrast';
import { DEFAULTS } from '@/features/trainer/core';

/** A 20 x 6 grid over a 120 x 36 px window: dark on the left half, light on the right. */
function twoWindows(): Backdrop {
    const cells = Array.from({ length: 6 * 20 }, (_, i) => (i % 20 < 10 ? 16 : 240));
    return { cols: 20, rows: 6, lum: btoa(String.fromCharCode(...cells)) };
}

describe('adaptive contrast', () => {
    it('reads each key against its own part of the backdrop', () => {
        const b = twoWindows(), lum = decodeBackdrop(b);
        const left = sampleRect(lum, b, 120, 36, { left: 6, top: 6, width: 30, height: 24 })!;
        const right = sampleRect(lum, b, 120, 36, { left: 72, top: 6, width: 30, height: 24 })!;
        expect(left.mean).toBe(16);
        expect(right.mean).toBe(240);
        expect(left.spread).toBe(0);
        // A key straddling both windows sees a busy backdrop.
        expect(sampleRect(lum, b, 120, 36, { left: 45, top: 6, width: 30, height: 24 })!.spread).toBeGreaterThan(100);
    });

    it('uses dark legends on light backgrounds and light ones on dark, with hysteresis', () => {
        expect(wantsDarkLegend(240, undefined)).toBe(true);
        expect(wantsDarkLegend(16, undefined)).toBe(false);
        expect(wantsDarkLegend(130, true)).toBe(true);
        expect(wantsDarkLegend(130, false)).toBe(false);
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
