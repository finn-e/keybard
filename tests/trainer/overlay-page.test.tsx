import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DEFAULTS } from '@/features/trainer/core';

const host = vi.hoisted(() => ({ state: null as unknown, configure: vi.fn(), command: vi.fn(), connect: vi.fn() }));
vi.mock('@/features/trainer/host', async (original) => ({
    ...(await original<typeof import('@/features/trainer/host')>()),
    useHost: () => ({ state: host.state, busy: false, error: '', local: false, build: null, configure: host.configure, command: host.command, connect: host.connect }),
}));
vi.mock('@/contexts/LayoutSettingsContext', () => ({ useLayoutSettings: () => ({ internationalLayout: 'de' }) }));
import TrainerPage from '@/features/trainer/TrainerPage';

const connected = (layoutId = 'de') => ({
    config: { ...DEFAULTS, layoutId, highlightPressed: true, manualDefault: 1 }, revision: 1, session: 's', valid: true, status: 'Connected',
    devices: [{ id: 'a', name: 'Svalboard Right', serial: 'sval:1' }], selectedDevice: 'a',
});

beforeEach(() => { host.state = null; vi.clearAllMocks(); });

describe('Overlay page', () => {
    it('offers Keybard Host and a way to connect to it when it is not connected', () => {
        render(<TrainerPage />);
        expect(screen.getByRole('region', { name: 'Install desktop overlay' })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: /Connect to Keybard Host/ }));
        expect(host.connect).toHaveBeenCalled();
    });

    it('names the board the overlay follows, points to the Host menus, and can disconnect', () => {
        host.state = connected();
        render(<TrainerPage />);
        expect(screen.getByText('The overlay follows Svalboard Right')).toBeTruthy();
        expect(screen.getByText(/settings are in its/)).toBeTruthy();
        expect(screen.queryByRole('group', { name: 'Overlay settings' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: /Disconnect/ }));
        expect(host.command).toHaveBeenCalledWith({ op: 'disconnect' });
    });

    it('keeps the overlay on Keybard’s keyboard language', () => {
        host.state = connected('us');
        render(<TrainerPage />);
        expect(host.configure).toHaveBeenCalledTimes(1);
        const update = host.configure.mock.calls[0][0] as (c: object) => object;
        expect(update({ ...DEFAULTS, layoutId: 'us' })).toMatchObject({ layoutId: 'de' });
    });

    it('sends nothing when the language already matches', () => {
        host.state = connected('de');
        render(<TrainerPage />);
        expect(host.configure).not.toHaveBeenCalled();
    });
});
