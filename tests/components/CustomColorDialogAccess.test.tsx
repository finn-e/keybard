import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CustomColorDialog from '../../src/components/CustomColorDialog';

beforeAll(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));
describe('Custom color access', () => {
    it('opens on the LED color, listed before the key color; exposes color targets and sliders, with no live write from focus or target selection', async () => {
        const onApply = vi.fn();
        const onOpenChange = vi.fn();
        const user = userEvent.setup();
        render(<CustomColorDialog open onOpenChange={onOpenChange} onApply={onApply} />);
        expect(screen.getByRole('button', { name: 'LED color', pressed: true })).toBeInTheDocument();
        const led = screen.getByRole('button', { name: 'LED color' });
        expect(led.compareDocumentPosition(screen.getByRole('button', { name: 'Key color' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        await user.click(screen.getByRole('button', { name: 'Key color' }));
        expect(screen.getByRole('button', { name: 'Key color', pressed: true })).toBeInTheDocument();
        for (const name of ['Hue', 'Saturation', 'Brightness']) expect(screen.getByRole('slider', { name })).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: /Edit hex color/ }));
        await user.clear(screen.getByRole('textbox', { name: 'Hex color' }));
        await user.type(screen.getByRole('textbox', { name: 'Hex color' }), '#ff0000{Escape}');
        await waitFor(() => expect(screen.getByRole('button', { name: /Edit hex color/ })).toHaveFocus());
        expect(onOpenChange).not.toHaveBeenCalled();
        expect(onApply).not.toHaveBeenCalled();
    });
});
