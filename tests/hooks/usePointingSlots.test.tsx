import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { POINTING_SLOT_MAX_READS, POINTING_SLOT_RETRY_MS, POINTING_SLOT_FALLBACK, usePointingSlots } from '../../src/hooks/usePointingSlots';
import { POINTING_DEMO_TOUR_MS } from '../../src/components/pointing-viz/simulate';
import { _setPointingVizEnabledForTest } from '../../src/features/pointing-viz-flag';
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
const tick = () => act(async () => { await vi.advanceTimersByTimeAsync(POINTING_SLOT_RETRY_MS); });
const setSearch = (search: string) => window.history.replaceState(null, '', `/keybard-ng/${search}`);

describe('usePointingSlots', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        getFragmentHardware.mockClear();
        replies.length = 0;
        ctx.isConnected = true;
        ctx.connectionSessionId = 1;
        ctx.keyboard = createSvalboardPointingKbinfo({ sixKey: true });
        setSearch('');
        _setPointingVizEnabledForTest(true);
    });
    afterEach(() => {
        vi.useRealTimers();
        setSearch('');
        _setPointingVizEnabledForTest(undefined);
    });

    it('shows nothing and reads nothing while the pointing-viz flag is off, even in demo mode', async () => {
        _setPointingVizEnabledForTest(false);
        ctx.keyboard = createSvalboardPointingKbinfo({ sixKey: true, hwDetection: [[IDX.left, ID.pointing_trackpoint]] });
        setSearch('?pointingDemo=tour');
        const { result } = renderHook(() => usePointingSlots());
        expect(result.current).toEqual([]);
        await act(async () => { await vi.advanceTimersByTimeAsync(POINTING_SLOT_RETRY_MS * (POINTING_SLOT_MAX_READS + 1)); });
        expect(getFragmentHardware).not.toHaveBeenCalled();
        expect(result.current).toEqual([]);
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

    it('shows "pending" and re-reads 0x18 every second until each slot settles', async () => {
        replies.push(
            new Map([[IDX.left, ID.pointing_trackpoint]]),
            new Map([[IDX.left, ID.pointing_trackpoint], [IDX.right, ID.pointing_none]]),
        );
        const { result } = renderHook(() => usePointingSlots());
        expect(kinds(result.current)).toEqual(['left:pending', 'right:pending']);
        await tick();
        expect(kinds(result.current)).toEqual(['left:trackpoint', 'right:pending']);
        await tick();
        expect(kinds(result.current)).toEqual(['left:trackpoint', 'right:none']);
        await tick();
        await tick();
        expect(getFragmentHardware).toHaveBeenCalledTimes(2);
    });

    it('gives up after six reads and shows "none" for a slot that never settles', async () => {
        replies.push(new Map([[IDX.left, ID.pointing_unknown]]));
        const { result } = renderHook(() => usePointingSlots());
        for (let i = 0; i < POINTING_SLOT_MAX_READS - 1; i++) await tick();
        expect(kinds(result.current)).toEqual(['left:unknown', 'right:pending']);
        await tick();
        expect(kinds(result.current)).toEqual(['left:unknown', 'right:none']);
        for (let i = 0; i < 3; i++) await tick();
        expect(getFragmentHardware).toHaveBeenCalledTimes(POINTING_SLOT_MAX_READS);
    });

    it('drops the previous session\'s reads on reconnect', async () => {
        replies.push(new Map([[IDX.left, ID.pointing_trackpoint], [IDX.right, ID.pointing_trackpoint]]));
        const { result, rerender } = renderHook(() => usePointingSlots());
        await tick();
        expect(kinds(result.current)).toEqual(['left:trackpoint', 'right:trackpoint']);
        ctx.connectionSessionId = 2;
        rerender();
        expect(kinds(result.current)).toEqual(['left:pending', 'right:pending']);
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

    describe('demo mode', () => {
        it('shows both hands from the URL, at the definition\'s positions, without reading the board', async () => {
            setSearch('?pointingDemo=trackball,touchpad');
            ctx.isConnected = false;
            const { result } = renderHook(() => usePointingSlots());
            expect(kinds(result.current)).toEqual(['left:trackball', 'right:touchpad']);
            expect(result.current[1]).toMatchObject({ demo: true });
            expect(result.current[1].x).toBeCloseTo(17.35, 5);
            expect(result.current[1].y).toBeCloseTo(4.15, 5);
            await tick();
            expect(getFragmentHardware).not.toHaveBeenCalled();
        });

        it('fits the pocket when the definition has fingers and thumbs but no pointing instances', () => {
            setSearch('?pointingDemo=trackpoint');
            ctx.keyboard = createSvalboardPointingKbinfo({ withPointing: false });
            const { result } = renderHook(() => usePointingSlots());
            expect(kinds(result.current)).toEqual(['left:trackpoint', 'right:trackpoint']);
            expect(result.current[0].w).toBeCloseTo(3.8, 5);
            expect(result.current[0].h).toBeCloseTo(3.8, 5);
            expect(result.current[0].x).toBeCloseTo(3.85, 5);
            expect(result.current[1].x).toBeCloseTo(17.35, 5);
        });

        it("falls back to the fixed positions when the pocket can't be found", () => {
            setSearch('?pointingDemo=trackpoint');
            const kb = createSvalboardPointingKbinfo({ withPointing: false });
            kb.composition = { instances: kb.composition!.instances.filter((i) => !/_(ring|middle)$/.test(i.id)) };
            ctx.keyboard = kb;
            const { result } = renderHook(() => usePointingSlots());
            expect(result.current[0]).toMatchObject(POINTING_SLOT_FALLBACK.left);
            expect(result.current[1]).toMatchObject(POINTING_SLOT_FALLBACK.right);
        });

        it('tours all three modules: each hand steps to the next every few seconds', async () => {
            setSearch('?pointingDemo=tour');
            const { result } = renderHook(() => usePointingSlots());
            expect(kinds(result.current)).toEqual(['left:trackball', 'right:touchpad']);
            await act(async () => { await vi.advanceTimersByTimeAsync(POINTING_DEMO_TOUR_MS); });
            expect(kinds(result.current)).toEqual(['left:touchpad', 'right:trackpoint']);
            await act(async () => { await vi.advanceTimersByTimeAsync(POINTING_DEMO_TOUR_MS); });
            expect(kinds(result.current)).toEqual(['left:trackpoint', 'right:trackball']);
            expect(result.current.every((s) => s.demo)).toBe(true);
            expect(getFragmentHardware).not.toHaveBeenCalled();
        });

        it('shows nothing without thumbs to place the slots by', () => {
            setSearch('?pointingDemo=1');
            ctx.keyboard = null;
            const { result } = renderHook(() => usePointingSlots());
            expect(result.current).toEqual([]);
        });
    });
});
