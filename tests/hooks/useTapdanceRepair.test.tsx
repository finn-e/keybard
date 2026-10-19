import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
    kb: {} as any,
    connectionState: 'connected',
    isConnected: true,
    session: 1,
    isInstant: false,
    setKeyboard: vi.fn(),
    queue: vi.fn(async (_d: string, _cb: () => Promise<void>, _m?: any) => {}),
    commit: vi.fn(async () => true),
    updateTapdance: vi.fn(async () => {}),
    saveSvil: vi.fn(async () => {}),
}));
vi.mock('@/contexts/KeyboardContext', () => ({ useKeyboard: () => ({
    keyboard: state.kb, setKeyboard: state.setKeyboard, isConnected: state.isConnected,
    connectionState: state.connectionState, connectionSessionId: state.session,
}) }));
vi.mock('@/contexts/ChangesContext', () => ({ useChanges: () => ({ queue: state.queue, commit: state.commit, isInstant: state.isInstant }) }));
vi.mock('@/services/keyboard.service', () => ({ keyboardService: { updateTapdance: state.updateTapdance, saveSvil: state.saveSvil } }));

import { useTapdanceRepair } from '@/hooks/useTapdanceRepair';

const td = (idx: number, over: Record<string, unknown> = {}) => ({ idx, tap: 'KC_NO', hold: 'KC_NO', doubletap: 'KC_NO', taphold: 'KC_NO', tapping_term: 200, enabled: true, ...over });
const board = (tapdances: any[], over: Record<string, unknown> = {}) => ({ rows: 1, cols: 1, svil_proto: 3, tapdance_count: tapdances.length, tapdances, ...over });
const descs = () => state.queue.mock.calls.map(c => c[0]);

describe('useTapdanceRepair', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        Object.assign(state, { connectionState: 'connected', isConnected: true, session: 1, isInstant: false });
    });

    it('writes 200 to every slot with a term below 20 ms and turns configured ones on, through pending changes', async () => {
        state.kb = board([td(0, { tapping_term: 0, enabled: false }), td(1, { tap: 'KC_A', tapping_term: 5 }), td(2, { tap: 'KC_B', enabled: false, tapping_term: 300 }), td(3, { tap: 'KC_C' })]);
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        renderHook(() => useTapdanceRepair());
        await waitFor(() => expect(descs()).toEqual(['tapdance 0', 'tapdance 1', 'tapdance 2', 'Save tap dances']));
        const updated = state.setKeyboard.mock.calls[0][0];
        expect(updated.tapdances.map((t: any) => t.tapping_term)).toEqual([200, 200, 300, 200]);
        expect(updated.tapdances.every((t: any) => t.enabled)).toBe(true);
        expect(state.queue.mock.calls[0][2]).toMatchObject({ type: 'tapdance', writeKey: 'tapdance:0', deferCommit: true });
        expect(state.commit).not.toHaveBeenCalled();
        expect(log.mock.calls.flat().join(' ')).toMatch(/2 term\(s\).*1 configured tap dance\(s\) turned on/);
        await state.queue.mock.calls[1][1]();
        expect(state.updateTapdance).toHaveBeenCalledWith(updated, 1);
    });

    it('commits at once in live mode', async () => {
        state.isInstant = true;
        state.kb = board([td(0, { tapping_term: 0 })]);
        renderHook(() => useTapdanceRepair());
        await waitFor(() => expect(state.commit).toHaveBeenCalledTimes(1));
    });

    it('runs once per connect', async () => {
        state.kb = board([td(0, { tapping_term: 0 })]);
        const { rerender } = renderHook(() => useTapdanceRepair());
        await waitFor(() => expect(state.queue).toHaveBeenCalledTimes(2));
        state.kb = board([td(0, { tapping_term: 0 })]);
        rerender();
        expect(state.queue).toHaveBeenCalledTimes(2);
        state.session = 2;
        rerender();
        await waitFor(() => expect(state.queue).toHaveBeenCalledTimes(4));
    });

    it.each([
        ['not connected', { isConnected: false }],
        ['still loading', { connectionState: 'loading' }],
    ])('waits while %s', async (_name, over) => {
        Object.assign(state, over);
        state.kb = board([td(0, { tapping_term: 0 })]);
        renderHook(() => useTapdanceRepair());
        await new Promise(r => setTimeout(r, 10));
        expect(state.queue).not.toHaveBeenCalled();
    });

    it.each([
        ['firmware without tap dance writes', { svil_proto: 2 }],
        ['no tap dance table', { tapdance_count: 0 }],
    ])('skips %s', async (_name, over) => {
        state.kb = board([td(0, { tapping_term: 0 })], over);
        renderHook(() => useTapdanceRepair());
        await new Promise(r => setTimeout(r, 10));
        expect(state.queue).not.toHaveBeenCalled();
        expect(state.setKeyboard).not.toHaveBeenCalled();
    });

    it('writes nothing when every tap dance is usable', async () => {
        state.kb = board([td(0), td(1, { tap: 'KC_A' })]);
        renderHook(() => useTapdanceRepair());
        await new Promise(r => setTimeout(r, 10));
        expect(state.queue).not.toHaveBeenCalled();
    });
});
