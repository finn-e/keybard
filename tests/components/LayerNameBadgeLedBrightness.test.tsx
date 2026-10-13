import { describe, expect, it, vi, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '../../src/components/ui/tooltip';
import { LayerNameBadge } from '../../src/components/LayerNameBadge';

const { usb, queue, dialog } = vi.hoisted(() => ({
    usb: { getLedBrightness: vi.fn(), setLedBrightness: vi.fn(), setLayerColor: vi.fn() },
    queue: vi.fn(),
    dialog: vi.fn(),
}));
vi.mock('@/services/usb.service', () => ({ usbInstance: usb }));
vi.mock('@/hooks/useLayerNames', () => ({ useLayerNames: () => ({ renameLayer: vi.fn(), nameError: null }) }));
vi.mock('@/contexts/KeyboardContext', () => ({ useKeyboard: () => ({
    keyboard: { layers: 1, keymap: [[0]], cosmetic: { layer: { 0: 'Alpha' } }, layer_colors: [{ hue: 10, sat: 20, val: 255 }] },
    setKeyboard: vi.fn(), isConnected: true,
}) }));
vi.mock('@/contexts/ChangesContext', () => ({ useChanges: () => ({ queue }) }));
vi.mock('@/contexts/LayoutLibraryContext', () => ({ useLayoutLibrary: () => ({ copyLayer: vi.fn() }) }));
vi.mock('@/services/sval.service', () => ({ svalService: { getLayerName: () => 'Alpha' } }));
vi.mock('@/components/PublishLayerDialog', () => ({ PublishLayerDialog: () => null }));
vi.mock('@/components/CustomColorDialog', () => ({ default: (props: any) => { dialog(props); return null; } }));

beforeAll(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));

describe('color dialog LED brightness', () => {
    it('opens on the board-wide brightness, and Apply saves it apart from the layer color', async () => {
        usb.getLedBrightness.mockResolvedValue(201);
        usb.setLedBrightness.mockResolvedValue(undefined);
        usb.setLayerColor.mockResolvedValue(undefined);
        const user = userEvent.setup();
        render(<TooltipProvider><LayerNameBadge selectedLayer={0} /></TooltipProvider>);
        await user.click(screen.getByRole('button', { name: 'Change color for layer 0' }));
        await user.click(screen.getByRole('button', { name: 'Custom layer color' }));
        await waitFor(() => expect(dialog).toHaveBeenLastCalledWith(expect.objectContaining({ open: true, initialLedVal: 201 })));

        const props = dialog.mock.lastCall![0];
        props.onPreviewLed({ hue: 30, sat: 40, val: 250 });
        await waitFor(() => expect(usb.setLedBrightness).toHaveBeenCalledWith(250, false));
        expect(usb.setLayerColor).toHaveBeenCalledWith(0, 30, 40, false);

        await props.onApply({ hue: 0, sat: 0, val: 255 }, { hue: 30, sat: 40, val: 250 });
        for (const call of queue.mock.calls) await call[1]();
        expect(queue.mock.calls.map(c => c[2].writeKey)).toEqual(['layer-color:0', 'led-brightness']);
        expect(usb.setLayerColor).toHaveBeenLastCalledWith(0, 30, 40);
        expect(usb.setLedBrightness).toHaveBeenLastCalledWith(250);
    });
});
