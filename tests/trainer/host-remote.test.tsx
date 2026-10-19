import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HOST_ORIGIN, useHost } from '@/features/trainer/host';

const fetchMock = vi.fn();
beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.keybardHost;
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string) => {
        if (String(url).endsWith('/api/host/bootstrap')) return new Response(JSON.stringify({ token: 't', apiVersion: 1 }));
        return new Response('{}', { status: 503 });
    });
    vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); delete document.documentElement.dataset.keybardHost; });

it('does not probe loopback from a hosted page until the user connects, then remembers it', async () => {
    const { result, unmount } = renderHook(() => useHost());
    await new Promise(r => setTimeout(r, 20));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.local).toBe(false);
    act(() => result.current.connect());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`${HOST_ORIGIN}/api/host/bootstrap`, expect.anything()));
    await waitFor(() => expect(localStorage.getItem('keybard-host-remote')).toBe('1'));
    unmount();
    fetchMock.mockClear();
    const again = renderHook(() => useHost());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`${HOST_ORIGIN}/api/host/bootstrap`, expect.anything()));
    again.unmount();
});

it('reports an unreachable host only when the user asked to connect', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const { result } = renderHook(() => useHost());
    act(() => result.current.connect());
    await waitFor(() => expect(result.current.error).toMatch(/Could not reach the overlay app/));
    expect(localStorage.getItem('keybard-host-remote')).toBeNull();
});

it('uses relative URLs on the copy of Keybard served by the host', async () => {
    document.documentElement.dataset.keybardHost = 'true';
    const { result, unmount } = renderHook(() => useHost());
    expect(result.current.local).toBe(true);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/host/bootstrap', expect.anything()));
    unmount();
});

it("keeps the host's release and bundled Keybard from bootstrap; older hosts are 'unknown'", async () => {
    document.documentElement.dataset.keybardHost = 'true';
    fetchMock.mockImplementation(async (url: string) => String(url).endsWith('/api/host/bootstrap')
        ? new Response(JSON.stringify({ token: 't', apiVersion: 1, version: 'vLaunch2', keybardCommit: '5954334' }))
        : new Response('{}', { status: 503 }));
    const current = renderHook(() => useHost());
    await waitFor(() => expect(current.result.current.build).toEqual({ version: 'vLaunch2', keybardCommit: '5954334' }));
    current.unmount();
    fetchMock.mockImplementation(async (url: string) => String(url).endsWith('/api/host/bootstrap')
        ? new Response(JSON.stringify({ token: 't', apiVersion: 1 }))
        : new Response('{}', { status: 503 }));
    const older = renderHook(() => useHost());
    await waitFor(() => expect(older.result.current.build).toEqual({ version: 'unknown', keybardCommit: null }));
    older.unmount();
});

it('fetches a new token and retries when a restarted host refuses a write', async () => {
    document.documentElement.dataset.keybardHost = 'true';
    // The host restarted: state keeps flowing, but only the new token may write.
    let liveToken = 'old', bootstraps = 0;
    const snapshot = { apiVersion: 1, config: { scale: 100 }, revision: 0, layoutRevision: 1, board: null, session: 's', valid: true };
    const writes: { token: string; body: unknown }[] = [];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
        const path = String(url);
        if (path.endsWith('/api/host/bootstrap')) { bootstraps++; return new Response(JSON.stringify({ token: liveToken, apiVersion: 1 })); }
        if (path.includes('/api/host/state')) return new Response(JSON.stringify(snapshot));
        const token = (init?.headers as Record<string, string>)['X-Keybard-Token'];
        writes.push({ token, body: JSON.parse(String(init?.body)) });
        if (token !== liveToken) return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 403 });
        return new Response(JSON.stringify(path.endsWith('/config') ? { revision: 1 } : { ok: true }));
    });
    const { result, unmount } = renderHook(() => useHost());
    await waitFor(() => expect(result.current.state).not.toBeNull());
    liveToken = 'new';
    let saved = false;
    await act(async () => { saved = await result.current.configure({ ...result.current.state!.config, scale: 70 }); });
    expect(saved).toBe(true);
    expect(writes.map(w => w.token)).toEqual(['old', 'new']);
    expect(result.current.state?.config.scale).toBe(70);
    await act(async () => { await result.current.command({ op: 'place' }); });
    expect(writes.at(-1)?.token).toBe('new');
    expect(result.current.error).toBe('');
    expect(bootstraps).toBe(2);
    unmount();
});
