import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';

import { PointingSlot, pointingSlotTitle } from '../../../src/components/pointing-viz/PointingSlot';
import { PointingPlaceholder } from '../../../src/components/pointing-viz/PointingPlaceholder';
import { DEFAULT_POINTING_VIZ_THEME, type PointingSampleSource, type PointingVizProps } from '../../../src/components/pointing-viz/types';
import type { PointingSlotState } from '../../../src/hooks/usePointingSlots';

const live = vi.hoisted(() => ({ source: null as PointingSampleSource | null, calls: [] as [string, boolean][] }));
vi.mock('@/hooks/usePointingLive', () => ({
    usePointingLive: (side: string, enabled: boolean) => {
        live.calls.push([side, enabled]);
        return enabled ? live.source : null;
    },
}));

const vizProps = vi.hoisted(() => ({ last: null as PointingVizProps | null }));
const fakeViz = (name: string) => (props: PointingVizProps) => {
    vizProps.last = props;
    return <div data-testid={`viz-${name}`} />;
};
vi.mock('../../../src/components/pointing-viz/TrackballFlowViz', () => ({ TrackballFlowViz: fakeViz('trackball') }));
vi.mock('../../../src/components/pointing-viz/TouchpadViz', () => ({ TouchpadViz: fakeViz('touchpad') }));
vi.mock('../../../src/components/pointing-viz/TrackpointViz', () => ({
    TrackpointViz: () => { throw new Error('boom'); },
}));

const source: PointingSampleSource = { latest: () => null, subscribe: () => () => {} };

const slot = (o: Partial<PointingSlotState>): PointingSlotState => ({
    instanceIdx: 10, instanceId: 'left_pointing', side: 'left', fragmentName: null, widget: null,
    x: 4.5, y: 4.75, w: 2.5, h: 2.5, kind: 'pending', ...o,
});

function setReducedMotion(reduce: boolean) {
    window.matchMedia = vi.fn().mockImplementation((q: string) => ({
        matches: reduce && q.includes('reduce'), media: q,
        addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(),
    })) as any;
}

describe('PointingSlot', () => {
    beforeEach(() => {
        live.source = source;
        live.calls = [];
        vizProps.last = null;
        setReducedMotion(false);
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    it.each([
        ['none', 'None'],
        ['pending', 'Detecting'],
        ['unknown', 'Unknown'],
    ] as const)('shows the %s placeholder without asking for live data', (kind, caption) => {
        const { container } = render(<PointingSlot slot={slot({ kind })} unitPx={60} style={{ left: 10, top: 20 }} />);
        expect(screen.getByText(caption)).toBeInTheDocument();
        expect(container.querySelector(`[data-pointing-placeholder="${kind}"]`)).not.toBeNull();
        expect(live.calls.every(([, enabled]) => enabled === false)).toBe(true);
    });

    it('lays out in key units: rounded corners, inset drawing area, click-through', async () => {
        const { container } = render(<PointingSlot slot={slot({ kind: 'trackball', sensor: 'pmw3360', description: 'PMW3360 trackball' })} unitPx={60} style={{ left: 270, top: 285 }} />);
        await screen.findByTestId('viz-trackball');
        const root = container.querySelector('[data-pointing-slot="left"]') as HTMLElement;
        expect(root.style.width).toBe('150px');
        expect(root.style.left).toBe('270px');
        expect(root.style.pointerEvents).toBe('none');
        const outline = screen.getByRole('img', { name: 'Left: PMW3360 trackball (detected)' });
        expect(outline.getAttribute('title')).toBe('Left: PMW3360 trackball (detected)');
        expect(outline.style.pointerEvents).toBe('auto');
        expect(outline.style.borderRadius).toBe(`${0.35 * 60}px`);
        expect(vizProps.last).toMatchObject({ side: 'left', width: 142, height: 142, reducedMotion: false, sensor: 'pmw3360', source });
        expect(live.calls).toContainEqual(['left', true]);
    });

    it('drops the outline for a live module and keeps it for a placeholder', async () => {
        const { container } = render(<PointingSlot slot={slot({ kind: 'touchpad', w: 3.8, h: 3.8 })} unitPx={40} style={{}} />);
        await screen.findByTestId('viz-touchpad');
        expect(vizProps.last).toMatchObject({ width: 144, height: 144 });
        expect((container.querySelector('[role="img"]') as HTMLElement).style.borderWidth).toBe('0px');
        const placeholder = render(<PointingSlot slot={slot({ kind: 'none' })} unitPx={40} style={{}} />);
        expect((placeholder.container.querySelector('[role="img"]') as HTMLElement).style.borderWidth).toBe('1px');
    });

    it('sizes the drawing area for the small key size', async () => {
        render(<PointingSlot slot={slot({ kind: 'touchpad', side: 'right' })} unitPx={30} style={{}} />);
        await screen.findByTestId('viz-touchpad');
        expect(vizProps.last).toMatchObject({ width: 67, height: 67, side: 'right' });
    });

    it('passes reduced motion to the viz', async () => {
        setReducedMotion(true);
        render(<PointingSlot slot={slot({ kind: 'trackball' })} unitPx={45} style={{}} />);
        await screen.findByTestId('viz-trackball');
        expect(vizProps.last?.reducedMotion).toBe(true);
    });

    it('shows the still module icon when the board reports no motion', () => {
        live.source = null;
        render(<PointingSlot slot={slot({ kind: 'trackball' })} unitPx={60} style={{}} />);
        expect(screen.getByText('Trackball')).toBeInTheDocument();
        expect(screen.queryByTestId('viz-trackball')).toBeNull();
    });

    it('falls back to the icon when a viz throws', async () => {
        render(<PointingSlot slot={slot({ kind: 'trackpoint' })} unitPx={60} style={{}} />);
        expect(await screen.findByText('TrackPoint')).toBeInTheDocument();
    });

    it('re-reads the theme when the <html> class changes', async () => {
        const { container } = render(<PointingSlot slot={slot({ kind: 'none' })} unitPx={60} style={{}} />);
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
        expect(pointingSlotTitle(slot({ kind: 'none' }))).toBe('Left: pointing module not reported');
        expect(pointingSlotTitle(slot({ kind: 'none', widget: { kind: 'pointing', module: 'none', w: 2.5, h: 2.5 } }))).toBe('Left: no pointing module (detected)');
        expect(pointingSlotTitle(slot({ side: 'right', kind: 'touchpad', demo: true }))).toBe('Right: Touchpad (demo)');
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
