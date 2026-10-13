import { describe, it, expect } from 'vitest';
import { act, render, screen } from '@testing-library/react';

import { PointingSlot, pointingSlotTitle } from '../../../src/components/pointing-viz/PointingSlot';
import { PointingPlaceholder } from '../../../src/components/pointing-viz/PointingPlaceholder';
import { DEFAULT_POINTING_VIZ_THEME } from '../../../src/components/pointing-viz/types';
import type { PointingSlotState } from '../../../src/hooks/usePointingSlots';

const slot = (o: Partial<PointingSlotState>): PointingSlotState => ({
    instanceIdx: 10, instanceId: 'left_pointing', side: 'left', fragmentName: null, widget: null,
    x: 4.5, y: 4.75, w: 2.5, h: 2.5, kind: 'pending', ...o,
});

describe('PointingSlot', () => {
    it.each([
        ['trackball', 'Trackball'],
        ['touchpad', 'Touchpad'],
        ['trackpoint', 'TrackPoint'],
        ['pending', 'Detecting'],
        ['unknown', 'Unknown'],
    ] as const)('draws the %s icon', (kind, caption) => {
        const { container } = render(<PointingSlot slot={slot({ kind })} unitPx={60} style={{ left: 10, top: 20 }} />);
        expect(screen.getByText(caption)).toBeInTheDocument();
        expect(container.querySelector(`[data-pointing-placeholder="${kind}"]`)).not.toBeNull();
        expect(container.querySelector('canvas')).toBeNull();
    });

    it('lays out in key units: rounded corners, inset drawing area, click-through', () => {
        const { container } = render(<PointingSlot slot={slot({ kind: 'trackball', sensor: 'pmw3389', description: 'PMW3389 trackball' })} unitPx={60} style={{ left: 270, top: 285 }} />);
        const root = container.querySelector('[data-pointing-slot="left"]') as HTMLElement;
        expect(root.style.width).toBe('150px');
        expect(root.style.left).toBe('270px');
        expect(root.style.pointerEvents).toBe('none');
        const outline = screen.getByRole('img', { name: 'Left: PMW3389 trackball (detected)' });
        expect(outline.getAttribute('title')).toBe('Left: PMW3389 trackball (detected)');
        expect(outline.style.pointerEvents).toBe('auto');
        expect(outline.style.borderRadius).toBe(`${0.35 * 60}px`);
        expect(outline.style.borderWidth).toBe('1px');
    });

    it('re-reads the theme when the <html> class changes', async () => {
        const { container } = render(<PointingSlot slot={slot({ kind: 'trackball' })} unitPx={60} style={{}} />);
        const outline = container.querySelector('[role="img"]') as HTMLElement;
        const before = outline.style.borderColor;
        document.documentElement.style.setProperty('--border', 'rgb(1, 2, 3)');
        await act(async () => {
            document.documentElement.classList.add('dark');
            await Promise.resolve();
        });
        expect(outline.style.borderColor).toBe('rgb(1, 2, 3)');
        expect(outline.style.borderColor).not.toBe(before);
        document.documentElement.classList.remove('dark');
        document.documentElement.style.removeProperty('--border');
    });
});

describe('pointingSlotTitle', () => {
    it('describes each state', () => {
        expect(pointingSlotTitle(slot({ kind: 'pending' }))).toBe('Left: detecting pointing module');
        expect(pointingSlotTitle(slot({ kind: 'none' }))).toBe('Left: no pointing module (detected)');
        expect(pointingSlotTitle(slot({ side: 'right', kind: 'touchpad' }))).toBe('Right: Touchpad (detected)');
        expect(pointingSlotTitle(slot({ kind: 'trackpoint' }))).toBe('Left: TrackPoint (detected)');
    });
});

describe('PointingPlaceholder', () => {
    it('spins only while detecting', () => {
        const { container, rerender } = render(<PointingPlaceholder kind="pending" width={100} height={100} theme={DEFAULT_POINTING_VIZ_THEME} />);
        expect(container.querySelector('.kb-pointing-spin')).not.toBeNull();
        rerender(<PointingPlaceholder kind="none" width={100} height={100} theme={DEFAULT_POINTING_VIZ_THEME} />);
        expect(container.querySelector('.kb-pointing-spin')).toBeNull();
        expect(container.querySelector('svg')?.getAttribute('width')).toBe('40');
    });
});
