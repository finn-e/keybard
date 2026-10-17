import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appStorage } from '../../src/utils/app-storage';
import { HOST_ORIGIN, notifyHostLayoutChanged, resetHostRefreshForTests } from '../../src/features/trainer/host';

const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

describe('telling Keybard Overlay the layout changed', () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    const commands = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/host/command')).map(([, init]) => JSON.parse(init.body).op);

    beforeEach(() => {
        vi.useFakeTimers();
        resetHostRefreshForTests();
        fetchMock = vi.fn((url: string) => String(url).endsWith('/bootstrap') ? json(200, { token: 't1', apiVersion: 1 }) : json(202, { accepted: true }));
        vi.stubGlobal('fetch', fetchMock);
        delete document.documentElement.dataset.keybardHost;
        try { appStorage.removeItem('keybard-host-remote'); } catch { /* ignore */ }
    });
    afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

    it('stays quiet on a hosted page that never connected to the host', async () => {
        notifyHostLayoutChanged();
        await vi.runAllTimersAsync();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('sends one refresh for a burst of saves, half a second after the last', async () => {
        appStorage.setItem('keybard-host-remote', '1');
        notifyHostLayoutChanged();
        await vi.advanceTimersByTimeAsync(300);
        notifyHostLayoutChanged();
        await vi.advanceTimersByTimeAsync(400);
        expect(fetchMock).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(200);
        expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([`${HOST_ORIGIN}/api/host/bootstrap`, `${HOST_ORIGIN}/api/host/command`]);
        expect(fetchMock.mock.calls[1][1].headers['X-Keybard-Token']).toBe('t1');
        expect(commands()).toEqual(['refresh']);
    });

    it('talks to its own host without a remembered connection when served by it', async () => {
        document.documentElement.dataset.keybardHost = 'true';
        notifyHostLayoutChanged();
        await vi.runAllTimersAsync();
        expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/host/bootstrap', '/api/host/command']);
    });

    it('falls back to reload on an older host, and keeps using it', async () => {
        appStorage.setItem('keybard-host-remote', '1');
        fetchMock.mockImplementation((url: string, init?: RequestInit) => {
            if (String(url).endsWith('/bootstrap')) return json(200, { token: 't1', apiVersion: 1 });
            return JSON.parse(String(init?.body)).op === 'refresh' ? json(400, { error: 'Unknown command' }) : json(202, { accepted: true });
        });
        notifyHostLayoutChanged();
        await vi.runAllTimersAsync();
        notifyHostLayoutChanged();
        await vi.runAllTimersAsync();
        expect(commands()).toEqual(['refresh', 'reload', 'reload']);
    });

    it('fetches a new token once when the host restarted', async () => {
        appStorage.setItem('keybard-host-remote', '1');
        let token = 0;
        fetchMock.mockImplementation((url: string, init?: RequestInit) => {
            if (String(url).endsWith('/bootstrap')) return json(200, { token: `t${++token}`, apiVersion: 1 });
            return (init?.headers as Record<string, string>)['X-Keybard-Token'] === 't2' ? json(202, {}) : json(403, {});
        });
        notifyHostLayoutChanged();
        await vi.runAllTimersAsync();
        expect(commands()).toEqual(['refresh', 'refresh']);
        expect(token).toBe(2);
    });

    it('does nothing when the host is not running', async () => {
        appStorage.setItem('keybard-host-remote', '1');
        fetchMock.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')));
        notifyHostLayoutChanged();
        await expect(vi.runAllTimersAsync()).resolves.not.toThrow();
        expect(commands()).toEqual([]);
    });
});
