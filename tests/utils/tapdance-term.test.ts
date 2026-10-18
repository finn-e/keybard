import { describe, expect, it } from 'vitest';
import { DEFAULT_TAPDANCE_TERM_MS, MIN_TAPDANCE_TERM_MS, clampTapdanceTerm, isUnusableTapdanceTerm, repairTapdances, usableTapdanceTerm } from '@/utils/tapdance-term';
import type { TapdanceEntry } from '@/types/keyboard.types';

const td = (over: Partial<TapdanceEntry> = {}): TapdanceEntry => ({ idx: 0, tap: 'KC_NO', hold: 'KC_NO', doubletap: 'KC_NO', taphold: 'KC_NO', tapping_term: 200, enabled: true, ...over });

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

describe('repairTapdances', () => {
    it('sets every term below 20 ms to 200, empty or configured', () => {
        const repair = repairTapdances([
            td({ idx: 0, tapping_term: 0, enabled: false }),
            td({ idx: 1, tap: 'KC_A', tapping_term: 10 }),
            td({ idx: 2, tap: 'KC_B', tapping_term: 350 }),
        ]);
        expect(repair.terms).toEqual([0, 1]);
        expect(repair.changed).toEqual([0, 1]);
        expect(repair.tapdances.map(t => t.tapping_term)).toEqual([200, 200, 350]);
    });

    it('turns on configured tap dances stored off, and leaves their term', () => {
        const repair = repairTapdances([td({ tap: 'KC_A', tapping_term: 300, enabled: false }), td({ enabled: false })]);
        expect(repair.enabled).toEqual([0]);
        expect(repair.changed).toEqual([0]);
        expect(repair.tapdances[0]).toMatchObject({ enabled: true, tapping_term: 300 });
    });

    it('changes nothing on a board that is already usable', () => {
        const tapdances = [td({ tap: 'KC_A' }), td({ tapping_term: 20, enabled: false })];
        const repair = repairTapdances(tapdances);
        expect(repair.changed).toEqual([]);
        expect(repair.tapdances).toBe(tapdances);
    });
});
