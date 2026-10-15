import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BoardIdentitySection from '../../src/layout/SecondarySidebar/Panels/BoardIdentitySection';

const keyboardContext = { isConnected: true, runDeviceMaintenance: vi.fn(async (operation: () => Promise<unknown>) => operation()) };
vi.mock('@/contexts/KeyboardContext', () => ({ useKeyboard: () => keyboardContext }));

const svc = vi.hoisted(() => ({ getInfo: vi.fn(), setName: vi.fn(), restart: vi.fn() }));
vi.mock('@/services/identity.service', async (orig) => {
    const actual = await orig<typeof import('../../src/services/identity.service')>();
    return { ...actual, identityService: svc };
});

const info = (over = {}) => ({ available: true, name: 'Lab board', nameMaxBytes: 64, serialSource: 1, serial: 'sval:E46498769F365934', ...over });

describe('BoardIdentitySection', () => {
    beforeEach(() => {
        vi.spyOn(window, "confirm").mockReturnValue(true);
        svc.getInfo.mockReset();
        svc.setName.mockReset();
        svc.restart.mockReset();
    });

    it('renders nothing for firmware without an identity', async () => {
        svc.getInfo.mockResolvedValue(null);
        const { container } = render(<BoardIdentitySection />);
        await waitFor(() => expect(svc.getInfo).toHaveBeenCalled());
        expect(container.querySelector('[data-testid="board-identity"]')).toBeNull();
    });

    it('shows the name and serial, saves an edit, then offers a restart', async () => {
        svc.getInfo.mockResolvedValue(info());
        svc.setName.mockResolvedValue(0);
        svc.restart.mockResolvedValue(undefined);
        render(<BoardIdentitySection />);

        const input = (await screen.findByLabelText('Board name')) as HTMLInputElement;
        expect(input.value).toBe('Lab board');
        expect(screen.getByText('sval:E46498769F365934')).toBeTruthy();
        const save = screen.getByRole('button', { name: 'Save now' }) as HTMLButtonElement;
        expect(save.disabled).toBe(true);

        fireEvent.change(input, { target: { value: 'Morgan’s Sval ✓' } });
        expect(screen.getByText('Not saved yet')).toBeTruthy();
        expect(save.disabled).toBe(false);
        fireEvent.click(save);

        await waitFor(() => expect(svc.setName).toHaveBeenCalledWith('Morgan’s Sval ✓'));
        fireEvent.click(await screen.findByRole('button', { name: 'Restart keyboard' }));
        await waitFor(() => expect(svc.restart).toHaveBeenCalled());
    });

    it('recovers from a failed save and allows retrying', async () => {
        svc.getInfo.mockResolvedValue(info());
        svc.setName.mockRejectedValueOnce(new Error('USB Command Timeout')).mockResolvedValueOnce(0);
        render(<BoardIdentitySection />);
        fireEvent.change(await screen.findByLabelText('Board name'), { target: { value: 'New name' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save now' }));
        expect(await screen.findByText(/Couldn't save the name/)).toBeTruthy();
        const save = screen.getByRole('button', { name: 'Save now' }) as HTMLButtonElement;
        expect(save.disabled).toBe(false);
        fireEvent.click(save);
        expect(await screen.findByRole('button', { name: 'Restart keyboard' })).toBeTruthy();
    });

    it('recovers from a failed restart', async () => {
        svc.getInfo.mockResolvedValue(info());
        svc.setName.mockResolvedValue(0);
        svc.restart.mockRejectedValue(new Error('USB Command Timeout'));
        render(<BoardIdentitySection />);
        fireEvent.change(await screen.findByLabelText('Board name'), { target: { value: 'New name' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save now' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Restart keyboard' }));
        expect(await screen.findByText(/Couldn't confirm the restart/)).toBeTruthy();
        expect((screen.getByRole('button', { name: 'Restart keyboard' }) as HTMLButtonElement).disabled).toBe(false);
    });

    it('blocks names over 32 characters', async () => {
        svc.getInfo.mockResolvedValue(info({ name: '' }));
        render(<BoardIdentitySection />);
        const input = await screen.findByLabelText('Board name');
        fireEvent.change(input, { target: { value: 'x'.repeat(33) } });
        expect(screen.getByText(/at most 32 characters/)).toBeTruthy();
        expect((screen.getByRole('button', { name: 'Save now' }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('says when the keyboard has nowhere to keep a name', async () => {
        svc.getInfo.mockResolvedValue(info({ available: false, name: '' }));
        render(<BoardIdentitySection />);
        expect(await screen.findByText(/no room for a name/)).toBeTruthy();
        expect(screen.queryByLabelText('Board name')).toBeNull();
    });
    it('does not perform immediate maintenance when confirmation is cancelled', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(false);
        svc.getInfo.mockResolvedValue(info());
        render(<BoardIdentitySection />);
        fireEvent.change(await screen.findByLabelText('Board name'), {target: {value: 'New name'}});
        fireEvent.click(screen.getByRole('button', {name: 'Save now'}));
        expect(svc.setName).not.toHaveBeenCalled();
    });

});

describe('BoardIdentitySection board actions', () => {
    beforeEach(() => {
        vi.spyOn(window, "confirm").mockReturnValue(true);
        svc.getInfo.mockReset();
        svc.restart.mockReset();
    });

    it('offers Restart keyboard without a rename first', async () => {
        svc.getInfo.mockResolvedValue(info());
        svc.restart.mockResolvedValue(undefined);
        render(<BoardIdentitySection />);
        fireEvent.click(await screen.findByRole('button', { name: 'Restart keyboard' }));
        await waitFor(() => expect(svc.restart).toHaveBeenCalled());
    });

    it('copies the serial', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
        svc.getInfo.mockResolvedValue(info());
        render(<BoardIdentitySection />);
        fireEvent.click(await screen.findByRole('button', { name: 'Copy serial' }));
        await waitFor(() => expect(writeText).toHaveBeenCalledWith('sval:E46498769F365934'));
        expect(await screen.findByText('Copied')).toBeTruthy();
    });
});
