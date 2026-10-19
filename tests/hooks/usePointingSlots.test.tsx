import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { usePointingSlots } from '../../src/hooks/usePointingSlots';
import { FragmentComposerService } from '../../src/services/fragment-composer.service';
import { FragmentService } from '../../src/services/fragment.service';
import { KleService } from '../../src/services/kle.service';
import { createSvalboardPointingKbinfo, POINTING_FRAGMENT_IDS as ID, POINTING_INSTANCE_IDX as IDX } from '../fixtures/fragments.fixture';

const ctx = { keyboard: null as any, isConnected: true, connectionSessionId: 1 };
const replies: Map<number, number>[] = [];
const getFragmentHardware = vi.fn(async () => (replies.length > 1 ? replies.shift()! : replies[0] ?? new Map()));
const composer = new FragmentComposerService(new KleService(), new FragmentService(null as any));

vi.mock('@/contexts/KeyboardContext', () => ({ useKeyboard: () => ctx }));
vi.mock('@/services/keyboard.service', () => ({
    keyboardService: {
        getFragmentHardware: () => getFragmentHardware(),
        getFragmentComposer: () => composer,
    },
}));

const kinds = (slots: { side: string; kind: string }[]) => slots.map((s) => `${s.side}:${s.kind}`);
const tick = () => act(async () => { await vi.advanceTimersByTimeAsync(2000); });
const setSearch = (search: string) => window.history.replaceState(null, '', `/keybard/${search}`);

describe('usePointingSlots', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        getFragmentHardware.mockClear();
        replies.length = 0;
        ctx.isConnected = true;
        ctx.connectionSessionId = 1;
        ctx.keyboard = createSvalboardPointingKbinfo({ sixKey: true });
        setSearch('');
    });
    afterEach(() => {
        vi.useRealTimers();
        setSearch('');
    });

    it('shows each detected module by default', () => {
        ctx.keyboard = createSvalboardPointingKbinfo({
            sixKey: true,
            hwDetection: [[IDX.left, ID.pointing_trackball_pmw3389], [IDX.right, ID.pointing_trackpoint]],
        });
        const { result } = renderHook(() => usePointingSlots());
        expect(kinds(result.current)).toEqual(['left:trackball', 'right:trackpoint']);
        expect(result.current[0].sensor).toBe('pmw3389');
    });

    it('has no URL switch: old demo and flag parameters change nothing', () => {
        ctx.keyboard = createSvalboardPointingKbinfo({ sixKey: true, hwDetection: [[IDX.left, ID.pointing_trackpoint], [IDX.right, ID.pointing_trackpoint]] });
        setSearch('?pointingDemo=tour&pointingViz=1');
        const { result } = renderHook(() => usePointingSlots());
        expect(kinds(result.current)).toEqual(['left:trackpoint', 'right:trackpoint']);
    });

    it('has no slot for a hand detected with no module', () => {
        ctx.keyboard = createSvalboardPointingKbinfo({ sixKey: true, hwDetection: [[IDX.left, ID.pointing_none], [IDX.right, ID.pointing_trackpoint]] });
        const { result } = renderHook(() => usePointingSlots());
        expect(kinds(result.current)).toEqual(['right:trackpoint']);
    });

    it('uses the detection read at connect without reading again once both slots have settled', async () => {
        ctx.keyboard = createSvalboardPointingKbinfo({
            sixKey: true,
            hwDetection: [[IDX.left, ID.pointing_trackball_pmw3360], [IDX.right, ID.pointing_touchpad_azoteq]],
        });
        const { result } = renderHook(() => usePointingSlots());
        expect(kinds(result.current)).toEqual(['left:trackball', 'right:touchpad']);
        expect(result.current[0]).toMatchObject({ sensor: 'pmw3360', description: 'PMW3360 trackball' });
        expect(result.current[0].w).toBeCloseTo(3.8, 5);
        expect(result.current[0].h).toBeCloseTo(3.8, 5);
        expect(result.current[0].x).toBeCloseTo(3.85, 5);
        expect(result.current[0].y).toBeCloseTo(4.15, 5);
        await tick();
        expect(getFragmentHardware).not.toHaveBeenCalled();
    });

    it('shows "pending" until the keyboard carries the detection, and never reads the board itself', async () => {
        const { result, rerender } = renderHook(() => usePointingSlots());
        expect(kinds(result.current)).toEqual(['left:pending', 'right:pending']);
        await tick();
        expect(getFragmentHardware).not.toHaveBeenCalled();
        // The late-detection poller writes into fragmentState.hwDetection.
        ctx.keyboard = { ...ctx.keyboard, fragmentState: { ...ctx.keyboard.fragmentState, hwDetection: new Map([[IDX.left, ID.pointing_trackpoint], [IDX.right, ID.pointing_none]]) } };
        rerender();
        expect(kinds(result.current)).toEqual(['left:trackpoint']);
    });

    it('is empty when disconnected (a file-loaded layout shows no slot)', () => {
        ctx.isConnected = false;
        const { result } = renderHook(() => usePointingSlots());
        expect(result.current).toEqual([]);
        expect(getFragmentHardware).not.toHaveBeenCalled();
    });

    it('is empty for a definition without pointing instances, with no 0x2C fallback', async () => {
        ctx.keyboard = createSvalboardPointingKbinfo({ withPointing: false });
        const { result } = renderHook(() => usePointingSlots());
        expect(result.current).toEqual([]);
        await tick();
        expect(getFragmentHardware).not.toHaveBeenCalled();
    });

});
