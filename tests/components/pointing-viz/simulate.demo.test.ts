import { describe, it, expect } from 'vitest';

import { parsePointingDemo, pointingDemoTourModule, POINTING_DEMO_TOUR } from '../../../src/components/pointing-viz/simulate';

describe('parsePointingDemo', () => {
    it('reads left,right modules, a single module for both hands, and the default pair', () => {
        expect(parsePointingDemo('?pointingDemo=trackpoint,trackball')).toEqual({ left: 'trackpoint', right: 'trackball' });
        expect(parsePointingDemo('?pointingDemo=touchpad')).toEqual({ left: 'touchpad', right: 'touchpad' });
        expect(parsePointingDemo('?pointingDemo=1')).toEqual({ left: 'trackball', right: 'touchpad' });
        expect(parsePointingDemo('?pointingDemo=off')).toBeNull();
        expect(parsePointingDemo('')).toBeNull();
    });

    it('pins a mode', () => {
        expect(parsePointingDemo('?pointingDemo=trackball&pointingDemoMode=scroll')).toMatchObject({ mode: 'scroll' });
    });

    it('tours all three modules, hands one apart, so every module shows on each hand', () => {
        expect(parsePointingDemo('?pointingDemo=tour')).toEqual({ left: 'trackball', right: 'touchpad', tour: true });
        expect(parsePointingDemo('?pointingDemo=all&pointingDemoMode=scroll')).toMatchObject({ tour: true, mode: 'scroll' });
        for (const side of ['left', 'right'] as const) {
            const seen = new Set([0, 1, 2].map((step) => pointingDemoTourModule(side, step)));
            expect([...seen].sort()).toEqual([...POINTING_DEMO_TOUR].sort());
        }
        for (let step = 0; step < 3; step++) {
            expect(pointingDemoTourModule('left', step)).not.toBe(pointingDemoTourModule('right', step));
        }
    });
});
