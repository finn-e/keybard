import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { coveredCells, keyPad, type Backdrop } from '@/features/trainer/adaptiveContrast';
import { OverlaySurface, capital } from '@/features/trainer/OverlaySurface';
import { DEFAULTS, changedPreferences, haloColor } from '@/features/trainer/core';
import { surfaceKeys } from '@/features/trainer/useSurfaceKeys';
import { keyService } from '@/services/key.service';

const hostState = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('@/features/trainer/host', async (original) => ({
    ...(await original<typeof import('@/features/trainer/host')>()),
    useHost: () => ({ state: hostState.current }),
}));
import HostOverlay from '@/features/trainer/HostOverlay';

const grid = (cols: number, rows: number, value: number): Backdrop =>
    ({ cols, rows, lum: btoa(String.fromCharCode(...new Array(cols * rows).fill(value))) });

describe('masking what isn\'t background', () => {
    it('covers each key padded by its outline reach, and the Host\'s masked rects', () => {
        const b: Backdrop = { ...grid(30, 10, 0), mask: [[100, 0, 20, 40]] };
        const covered = coveredCells(b, 120, 40, [{ left: 20, top: 12, width: 16, height: 16 }], 8);
        const at = (x: number, y: number) => covered[Math.floor(y / 4) * 30 + Math.floor(x / 4)];
        expect(at(14, 20)).toBe(1);   // inside the pad, left of the key
        expect(at(4, 20)).toBe(0);    // beyond it
        expect(at(110, 20)).toBe(1);  // a Host-masked rect (e.g. under the controls)
    });

    it('pads by half the outline and its halo at the overlay\'s scale, plus a cell', () => {
        expect(keyPad(1, 1, 4)).toBe(2 + 4);
        expect(keyPad(4, 2.5, 4)).toBe(8 + 4);
    });
});

describe('Capital letters', () => {
    it('upper-cases single letters but leaves ß, whose capital is two letters', () => {
        expect(capital('a')).toBe('A');
        expect(capital('é')).toBe('É');
        expect(capital('ß')).toBe('ß');
    });

    it('applies to plain text labels as well as legends', () => {
        const keys = [{ id: 1, x: 0, y: 0, w: 1, h: 1, label: 'a', code: 4, layer: 0, hand: 'Left' }];
        const { container } = render(<OverlaySurface keys={keys} appearance={DEFAULTS.appearance} changed={new Set()} held={new Set()}
            hidden={new Set()} effect="Off" duration={150} capitals />);
        const text = container.querySelector('text')!;
        expect(text.textContent).toBe('A');
        expect(text.getAttribute('font-size')).toBe('18');
    });
});

describe('halo', () => {
    function draw(halo: boolean, width = 1) {
        const code = keyService.parse('KC_A')!;
        const keys = surfaceKeys({ rows: 10, cols: 6, keymap: [[code]], keylayout: { 0: { row: 0, col: 0, x: 0, y: 0, w: 1, h: 1 } } }, 0, 1, 'Both', 'us');
        return render(<OverlaySurface keys={keys} appearance={{ ...DEFAULTS.appearance, halo, width }} changed={new Set()} held={new Set()}
            hidden={new Set()} effect="Off" duration={150} />).container;
    }

    it('traces the outline in the contrasting color and builds the legend halo from stacked shadows', () => {
        const container = draw(true);
        const ring = container.querySelector('rect[fill="none"]')!;
        expect(ring.getAttribute('stroke')).toBe(haloColor(DEFAULTS.appearance.outline));
        expect(ring.getAttribute('stroke-width')).toBe('3');
        const filter = (container.querySelector('.trainer-key-legend') as HTMLElement).style.filter;
        expect(filter.match(/drop-shadow/g)).toHaveLength(3);
    });

    it('draws no halo when it is off or there is no outline', () => {
        expect(draw(false).querySelector('rect[fill="none"]')).toBeNull();
        expect(draw(true, 0).querySelector('rect[fill="none"]')).toBeNull();
        expect((draw(false).querySelector('.trainer-key-legend') as HTMLElement).style.filter).toBe('');
    });
});

describe('saving Trainer settings to the Host', () => {
    it('lists only the preferences that changed', () => {
        const before = DEFAULTS, after = { ...DEFAULTS, duration: 300, appearance: { ...DEFAULTS.appearance, halo: false } };
        expect(changedPreferences(before, after)).toEqual({ duration: 300, appearance: after.appearance });
        expect(changedPreferences(before, { ...DEFAULTS })).toEqual({});
    });

});

describe('the overlay applying adaptive contrast', () => {
    const code = keyService.parse('KC_A')!;
    const board = { rows: 10, cols: 6, keymap: [[code]], keylayout: { 0: { row: 0, col: 0, x: 0, y: 0, w: 1, h: 1 } }, trainerLabels: {} };
    beforeEach(() => {
        hostState.current = { valid: true, visible: true, board, active: 0, default: 1, modifiers: null, pressed: [], practiceHidden: [], practiceTarget: null,
            config: { ...DEFAULTS, manualDefault: 1, highlightPressed: false, adaptiveContrast: true } };
        vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ left: 200, top: 200, width: 40, height: 40, right: 240, bottom: 240, x: 200, y: 200, toJSON() {} } as DOMRect);
    });
    afterEach(() => vi.restoreAllMocks());

    const plate = (container: HTMLElement) => container.querySelectorAll('[data-key-id] rect')[1];
    const send = (detail: Backdrop | null) => act(() => { window.dispatchEvent(new CustomEvent('keybard-host-backdrop', { detail })); });

    it('restyles keys for a light background, and returns to the base look when the Host stops', () => {
        const { container } = render(<HostOverlay />);
        expect(plate(container).getAttribute('fill')).toBe(DEFAULTS.appearance.fill);
        send(grid(Math.round(innerWidth / 4), Math.round(innerHeight / 4), 240));
        expect(plate(container).getAttribute('fill')).toBe('#f5f7f8');   // light plate, dark legends
        send(null);
        expect(plate(container).getAttribute('fill')).toBe(DEFAULTS.appearance.fill);
    });

    it('re-applies the last background at once after the appearance changes', () => {
        const { container, rerender } = render(<HostOverlay />);
        send(grid(Math.round(innerWidth / 4), Math.round(innerHeight / 4), 240));
        hostState.current = { ...(hostState.current as object), config: { ...(hostState.current as { config: object }).config, appearance: { ...DEFAULTS.appearance, width: 2 } } };
        rerender(<HostOverlay />);
        expect(plate(container).getAttribute('fill')).toBe('#f5f7f8');
    });
});
