import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DEFAULTS } from '@/features/trainer/core';
import { HOST_DOWNLOAD } from '@/features/trainer/HostInstall';

const host = vi.hoisted(() => ({ state: null as unknown, error: '', configure: vi.fn(), command: vi.fn(), connect: vi.fn() }));
vi.mock('@/features/trainer/host', async (original) => ({
    ...(await original<typeof import('@/features/trainer/host')>()),
    useHost: () => ({ state: host.state, busy: false, error: host.error, local: false, build: null, configure: host.configure, command: host.command, connect: host.connect }),
}));
vi.mock('@/contexts/LayoutSettingsContext', () => ({ useLayoutSettings: () => ({ internationalLayout: 'de' }) }));
import { OverlayDialog, overlayRequested } from '@/features/trainer/OverlayDialog';

const connected = (layoutId = 'de') => ({
    config: { ...DEFAULTS, layoutId, highlightPressed: true, manualDefault: 1 }, revision: 1, session: 's', valid: true, status: 'Connected',
    devices: [{ id: 'a', name: 'Svalboard Right', serial: 'sval:1' }], selectedDevice: 'a',
});
const show = () => render(<OverlayDialog open onOpenChange={() => {}} />);

beforeEach(() => { host.state = null; host.error = ''; vi.clearAllMocks(); });

describe('Desktop overlay dialog', () => {
    it('offers the download and a connection when no Host is connected', () => {
        show();
        expect(screen.getByText('Keybard Host shows your layout above your other windows.')).toBeTruthy();
        expect(screen.getByRole('link', { name: /Download for Windows/ })).toHaveAttribute('href', HOST_DOWNLOAD);
        fireEvent.click(screen.getByRole('button', { name: /Connect/ }));
        expect(host.connect).toHaveBeenCalled();
    });

    it('names the board, opens the Host’s settings, and can disconnect', () => {
        host.state = connected();
        show();
        expect(screen.getByText('Keybard Host is following Svalboard Right.')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: /Overlay settings/ }));
        expect(host.command).toHaveBeenCalledWith({ op: 'colors' });
        fireEvent.click(screen.getByRole('button', { name: /Disconnect/ }));
        expect(host.command).toHaveBeenCalledWith({ op: 'disconnect' });
    });

    it('hides an old connection error once connected', () => {
        host.state = connected(); host.error = 'Host connection lost. The preview is paused.';
        show();
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('keeps the overlay on Keybard’s keyboard language, and only when it differs', () => {
        host.state = connected('us');
        const { unmount } = show();
        const update = host.configure.mock.calls[0][0] as (c: object) => object;
        expect(update({ ...DEFAULTS, layoutId: 'us' })).toMatchObject({ layoutId: 'de' });
        unmount(); vi.clearAllMocks();
        host.state = connected('de');
        show();
        expect(host.configure).not.toHaveBeenCalled();
    });

    it('opens from the Host’s link and from older Hosts’ link', () => {
        expect(overlayRequested('#overlay')).toBe(true);
        expect(overlayRequested('#trainer')).toBe(true);
        expect(overlayRequested('#manual')).toBe(false);
    });
});
