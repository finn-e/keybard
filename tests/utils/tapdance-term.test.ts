import { describe, expect, it } from 'vitest';
import { DEFAULT_TAPDANCE_TERM_MS, MIN_TAPDANCE_TERM_MS, clampTapdanceTerm, isUnusableTapdanceTerm, usableTapdanceTerm } from '@/utils/tapdance-term';

describe('tap dance terms', () => {
    it('defaults to 200 ms with a 20 ms minimum', () => {
        expect(DEFAULT_TAPDANCE_TERM_MS).toBe(200);
        expect(MIN_TAPDANCE_TERM_MS).toBe(20);
    });

    it('treats terms below 20 ms as unusable', () => {
        expect([0, 19, -5, NaN, undefined].map(isUnusableTapdanceTerm)).toEqual([true, true, true, true, true]);
        expect([20, 200, 32767].map(isUnusableTapdanceTerm)).toEqual([false, false, false]);
        expect(usableTapdanceTerm(0)).toBe(200);
        expect(usableTapdanceTerm(350)).toBe(350);
    });

    it('clamps an entered term to 20..32767', () => {
        expect(clampTapdanceTerm(0)).toBe(20);
        expect(clampTapdanceTerm(5)).toBe(20);
        expect(clampTapdanceTerm(150.4)).toBe(150);
        expect(clampTapdanceTerm(99999)).toBe(32767);
    });
});
