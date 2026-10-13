import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useHost } from '../src/features/trainer/host';
import { DEFAULTS } from '../src/features/trainer/core';

it('builds a save from the Host\'s latest settings, so a change made in the overlay meanwhile survives', async () => {
    window.__keybardNativeState = true;
    const board = { rows: 10, cols: 6, keymap: [Array(60).fill(4)], trainerLabels: {} };
    const state = { apiVersion: 1, revision: 1, layoutRevision: 1, session: 'one', board, config: { ...DEFAULTS, manualDefault: 1, highlightPressed: false, capitalAlphas: false },
        active: 0, default: 1, valid: true, pressed: [], devices: [], practiceHidden: [], practiceTarget: null, visible: true };
    const posts: Array<{ config: Record<string, unknown> }> = [];
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        if (url.includes('bootstrap')) return new Response(JSON.stringify({ apiVersion: 1, token: 't' }));
        if (url.includes('/config')) { posts.push(JSON.parse(String(init?.body))); return new Response(JSON.stringify({ revision: 3 })); }
        return new Response(JSON.stringify(state));
    }));
    const { result, unmount } = renderHook(() => useHost());
    await waitFor(() => expect(result.current.state?.board).toEqual(board));
    // The overlay menu turns Capital letters on; the Host publishes the new config.
    act(() => window.dispatchEvent(new CustomEvent('keybard-host-state', { detail: { ...state, revision: 2, config: { ...state.config, capitalAlphas: true } } })));
    await act(async () => { await result.current.configure(latest => ({ ...latest, duration: 300 })); });
    expect(posts.at(-1)?.config).toMatchObject({ capitalAlphas: true, duration: 300 });
    unmount();
    delete window.__keybardNativeState;
    vi.unstubAllGlobals();
});
