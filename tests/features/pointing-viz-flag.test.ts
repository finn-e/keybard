import { describe, it, expect } from 'vitest';

import { readPointingVizFlag } from '../../src/features/pointing-viz-flag';

const memory = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};

describe('readPointingVizFlag', () => {
    it('is off by default', () => {
        expect(readPointingVizFlag('', undefined, memory())).toBe(false);
    });

    it('is on for a build with VITE_POINTING_VIZ=1 or a demo page', () => {
        expect(readPointingVizFlag('', '1', memory())).toBe(true);
        expect(readPointingVizFlag('?pointingDemo=tour', undefined, memory())).toBe(true);
    });

    it('remembers ?pointingViz=1 in this browser until ?pointingViz=0', () => {
        const s = memory();
        expect(readPointingVizFlag('?pointingViz=1', undefined, s)).toBe(true);
        expect(readPointingVizFlag('', undefined, s)).toBe(true);
        expect(readPointingVizFlag('?pointingViz=0', '1', s)).toBe(false);
        expect(readPointingVizFlag('', undefined, s)).toBe(false);
    });

    it('still follows the URL when storage throws', () => {
        const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
        expect(readPointingVizFlag('?pointingViz=1', undefined, broken)).toBe(true);
        expect(readPointingVizFlag('', undefined, broken)).toBe(false);
    });
});
