import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useHost } from '../src/features/trainer/host';
import { DEFAULTS } from '../src/features/trainer/core';
const board = { rows: 10, cols: 6, keymap: [Array(60).fill(4)], trainerLabels: {} };
const state = { apiVersion: 1, revision: 1, layoutRevision: 1, session: 'one', board, config: { ...DEFAULTS, manualDefault: 1, highlightPressed: false }, active: 0, default: 1, valid: true, pressed: [], devices: [], practiceHidden: [], practiceTarget: null, visible: true };
afterEach(() => { delete window.__keybardNativeState; vi.unstubAllGlobals(); });
it('applies native layer events immediately and keeps the cached layout', async () => {
    window.__keybardNativeState = true;
    const fetch = vi.fn().mockImplementation(async (url: string) => new Response(JSON.stringify(url.includes('bootstrap') ? { apiVersion: 1, token: 'test' } : state)));
    vi.stubGlobal('fetch', fetch);
    const { result } = renderHook(() => useHost());
    await waitFor(() => expect(result.current.state?.board).toEqual(board));
    act(() => window.dispatchEvent(new CustomEvent('keybard-host-state', { detail: { ...state, board: null, active: 8 } })));
    expect(result.current.state?.active).toBe(8);
    expect(result.current.state?.board).toEqual(board);
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(fetch.mock.calls.filter(([url]) => url.includes('/state'))).toHaveLength(1);
});
