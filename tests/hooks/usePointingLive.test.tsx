import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const ctx = { keyboard: { feature_flags2: 0x04 } as any, isConnected: true, connectionSessionId: 1 };
const fakeLive = vi.hoisted(() => ({
    setConnection: vi.fn(),
    release: vi.fn(),
    acquire: vi.fn(),
    sources: { left: { latest: () => null, subscribe: () => () => {} }, right: { latest: () => null, subscribe: () => () => {} } },
}));
vi.mock('@/contexts/KeyboardContext', () => ({ useKeyboard: () => ctx }));
vi.mock('@/services/keyboard.service', () => ({
    keyboardService: { hasPointingMotion: (kb: any) => ((kb?.feature_flags2 ?? 0) & 4) !== 0 },
}));
vi.mock('@/services/pointing-live.service', () => ({
    getPointingLive: () => ({
        setConnection: fakeLive.setConnection,
        acquire: () => { fakeLive.acquire(); return fakeLive.release; },
        source: (side: 'left' | 'right') => fakeLive.sources[side],
    }),
}));

import { usePointingLive } from '../../src/hooks/usePointingLive';

const setSearch = (search: string) => window.history.replaceState(null, '', `/keybard-ng/${search}`);

describe('usePointingLive', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        fakeLive.setConnection.mockClear();
        fakeLive.acquire.mockClear();
        fakeLive.release.mockClear();
        ctx.keyboard = { feature_flags2: 0x04 };
        ctx.isConnected = true;
        setSearch('');
    });
    afterEach(() => {
        vi.useRealTimers();
        setSearch('');
    });

    it('holds the shared poller while enabled and returns that side\'s stable source', () => {
        const { result, unmount } = renderHook(() => usePointingLive('right', true));
        expect(result.current).toBe(fakeLive.sources.right);
        expect(fakeLive.acquire).toHaveBeenCalledTimes(1);
        expect(fakeLive.setConnection).toHaveBeenCalledWith(ctx.keyboard, true, 1);
        unmount();
        expect(fakeLive.release).toHaveBeenCalledTimes(1);
    });

    it('does not poll when disabled', () => {
        renderHook(() => usePointingLive('left', false));
        expect(fakeLive.acquire).not.toHaveBeenCalled();
    });

    it('returns null without the feature bit, or while disconnected', () => {
        ctx.keyboard = { feature_flags2: 0x02 };
        expect(renderHook(() => usePointingLive('left', true)).result.current).toBeNull();
        ctx.keyboard = { feature_flags2: 0x04 };
        ctx.isConnected = false;
        expect(renderHook(() => usePointingLive('left', true)).result.current).toBeNull();
        expect(fakeLive.acquire).not.toHaveBeenCalled();
    });

    it('in demo mode shares one simulated source per side and stops it with the last holder', () => {
        setSearch('?pointingDemo=trackball,none&pointingDemoMode=scroll');
        ctx.isConnected = false;
        const a = renderHook(() => usePointingLive('left', true));
        const b = renderHook(() => usePointingLive('left', true));
        const source = a.result.current!;
        expect(source).not.toBeNull();
        expect(b.result.current).toBe(source);
        expect(source.latest()).toMatchObject({ mode: 'scroll' });
        expect(fakeLive.acquire).not.toHaveBeenCalled();

        const seen = vi.fn();
        source.subscribe(seen);
        a.unmount();
        vi.advanceTimersByTime(100);
        expect(seen).toHaveBeenCalled();
        b.unmount();
        seen.mockClear();
        vi.advanceTimersByTime(100);
        expect(seen).not.toHaveBeenCalled();

        // "none" has no stream.
        expect(renderHook(() => usePointingLive('right', true)).result.current).toBeNull();
    });

    it('in a demo tour follows the module the slot shows, swapping the simulated source', () => {
        setSearch('?pointingDemo=tour');
        ctx.isConnected = false;
        const { result, rerender, unmount } = renderHook(({ kind }) => usePointingLive('left', true, kind), {
            initialProps: { kind: 'trackball' as 'trackball' | 'trackpoint' },
        });
        const first = result.current;
        expect(first).not.toBeNull();
        rerender({ kind: 'trackpoint' });
        expect(result.current).not.toBeNull();
        expect(result.current).not.toBe(first);
        unmount();
    });
});
