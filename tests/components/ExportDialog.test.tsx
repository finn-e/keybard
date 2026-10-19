import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ExportDialog from '../../src/components/ExportDialog';

const mocks = vi.hoisted(() => ({
    downloadSvil: vi.fn(), downloadVIL: vi.fn(), onOpenChange: vi.fn(),
    keyboard: { name: 'Test', keymap: [[4, 0], [0, 1], [5, 1]], cosmetic: {} } as Record<string, unknown> | null,
}));
vi.mock('@/contexts/KeyboardContext', () => ({ useKeyboard: () => ({ keyboard: mocks.keyboard }) }));
vi.mock('@/services/file.service', () => ({ fileService: { downloadSvil: mocks.downloadSvil, downloadVIL: mocks.downloadVIL } }));

beforeEach(() => { vi.clearAllMocks(); mocks.downloadSvil.mockResolvedValue(undefined); mocks.downloadVIL.mockResolvedValue(undefined); });

describe('Export dialog', () => {
    it('offers .svil, .vil and Print as formats, .svil first', () => {
        render(<ExportDialog open onOpenChange={mocks.onOpenChange} />);
        const formats = screen.getAllByRole('radio').map((r) => r.textContent);
        expect(formats).toEqual(['.svil', '.vil', 'Print']);
        expect(screen.getByRole('radio', { name: '.svil' })).toHaveAttribute('aria-checked', 'true');
    });

    it('exports .svil with macros by default, then closes', async () => {
        render(<ExportDialog open onOpenChange={mocks.onOpenChange} />);
        fireEvent.click(screen.getByRole('button', { name: 'Export' }));
        await waitFor(() => expect(mocks.downloadSvil).toHaveBeenCalledWith(mocks.keyboard, true));
        expect(mocks.onOpenChange).toHaveBeenCalledWith(false);
    });

    it('exports .vil without macros when they are switched off', async () => {
        render(<ExportDialog open onOpenChange={mocks.onOpenChange} />);
        fireEvent.click(screen.getByRole('radio', { name: '.vil' }));
        fireEvent.click(screen.getByRole('switch', { name: 'Include macros' }));
        fireEvent.click(screen.getByRole('button', { name: 'Export' }));
        await waitFor(() => expect(mocks.downloadVIL).toHaveBeenCalledWith(mocks.keyboard, false));
    });

    it('prints the layers that have keys, with no file written', async () => {
        const printed = vi.fn();
        window.addEventListener('keybard-print', printed);
        render(<ExportDialog open onOpenChange={mocks.onOpenChange} />);
        fireEvent.click(screen.getByRole('radio', { name: 'Print' }));
        expect(screen.getByText('2 of 3 layers have keys on them.')).toBeInTheDocument();
        expect(screen.queryByRole('switch', { name: 'Include macros' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Print' }));
        await waitFor(() => expect(printed).toHaveBeenCalledTimes(1));
        const detail = (printed.mock.calls[0][0] as CustomEvent).detail;
        expect(detail.layers.map((l: { index: number }) => l.index)).toEqual([0, 2]);
        expect(mocks.downloadSvil).not.toHaveBeenCalled();
        window.removeEventListener('keybard-print', printed);
    });

    it('shows a failed export and stays open', async () => {
        mocks.downloadSvil.mockRejectedValue(new Error('Disk full'));
        render(<ExportDialog open onOpenChange={mocks.onOpenChange} />);
        fireEvent.click(screen.getByRole('button', { name: 'Export' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Disk full');
        expect(mocks.onOpenChange).not.toHaveBeenCalledWith(false);
    });
});
