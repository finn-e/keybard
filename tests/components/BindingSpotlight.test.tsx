import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import BindingSpotlight from '../../src/layout/BindingSpotlight';
import { nudgeBindingEditor } from '../../src/lib/bindingSpotlight';

const panels = vi.hoisted(() => ({ activePanel: 'combos' as string | null, itemToEdit: 3 as number | null, handleCloseEditor: vi.fn() }));
const binding = vi.hoisted(() => ({ selectedTarget: null as object | null }));
vi.mock('@/contexts/PanelsContext', () => ({ usePanels: () => panels }));
vi.mock('@/contexts/KeyBindingContext', () => ({ useKeyBinding: () => binding }));
vi.mock('@/contexts/KeyboardContext', () => ({ useKeyboard: () => ({ keyboard: { cosmetic: { tapdances: { '2': 'Shift Tap' } } } }) }));

beforeEach(() => {
    panels.activePanel = 'combos';
    panels.itemToEdit = 3;
    panels.handleCloseEditor.mockClear();
    binding.selectedTarget = null;
});
afterEach(cleanup);

const esc = () => fireEvent.keyDown(window, { key: 'Escape' });

describe('binding editor spotlight', () => {
    it('covers the page while an editor is open and is gone when it closes', () => {
        const view = render(<BindingSpotlight />);
        expect(document.querySelector('[data-binding-scrim]')).not.toBeNull();
        expect(document.documentElement.hasAttribute('data-binding-spotlight')).toBe(true);
        panels.itemToEdit = null;
        view.rerender(<BindingSpotlight />);
        expect(document.querySelector('[data-binding-scrim]')).toBeNull();
        expect(document.documentElement.hasAttribute('data-binding-spotlight')).toBe(false);
    });

    it('does not exit on a scrim click: it pulses the header and says how to finish', () => {
        render(<><div data-binding-editor-header="">Combo 3</div><BindingSpotlight /></>);
        fireEvent.click(document.querySelector('[data-binding-scrim]')!, { clientX: 100, clientY: 200 });
        expect(panels.handleCloseEditor).not.toHaveBeenCalled();
        expect(screen.getByRole('status')).toHaveTextContent('Finish Combo 3 to use this. Press Done.');
        expect(screen.getByText('Combo 3')).toHaveClass('binding-spotlight-pulse');
    });

    it('names the editor in the hint, with a tap dance by its own name', () => {
        panels.activePanel = 'tapdances';
        panels.itemToEdit = 2;
        render(<BindingSpotlight />);
        act(() => nudgeBindingEditor());
        expect(screen.getByRole('status')).toHaveTextContent('Finish Shift Tap to use this. Press Done.');
    });

    it('closes on Esc when no slot is selected', () => {
        render(<BindingSpotlight />);
        esc();
        expect(panels.handleCloseEditor).toHaveBeenCalledTimes(1);
    });

    it('leaves Esc to Typing Binds a Key when a slot is selected', () => {
        binding.selectedTarget = { type: 'combo', comboId: 3, comboSlot: 0 };
        render(<BindingSpotlight />);
        esc();
        expect(panels.handleCloseEditor).not.toHaveBeenCalled();
    });

    it('does not close on an Esc something else already handled, in a text field, or with a dialog open', () => {
        render(<><input aria-label="Name" /><div role="dialog" hidden data-testid="d" /><BindingSpotlight /></>);
        const handled = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
        handled.preventDefault();
        window.dispatchEvent(handled);
        fireEvent.keyDown(screen.getByLabelText('Name'), { key: 'Escape' });
        esc();
        expect(panels.handleCloseEditor).not.toHaveBeenCalled();
    });

    it('closes on no other key and does nothing when no editor is open', () => {
        render(<BindingSpotlight />);
        fireEvent.keyDown(window, { key: 'Enter' });
        fireEvent.keyDown(window, { key: 'a' });
        expect(panels.handleCloseEditor).not.toHaveBeenCalled();
        cleanup();
        panels.itemToEdit = null;
        render(<BindingSpotlight />);
        esc();
        expect(panels.handleCloseEditor).not.toHaveBeenCalled();
    });

    it('keeps covered controls out of the Tab order and turns their clicks into a nudge', () => {
        const onClick = vi.fn();
        const view = render(
            <>
                <div data-spotlight-cover=""><button type="button" onClick={onClick}>Rename Layer</button></div>
                <button type="button" data-spotlight-cover="" onClick={onClick}>Show All Layers</button>
                <button type="button" onClick={onClick}>Layer 2</button>
                <BindingSpotlight />
            </>,
        );
        const rename = screen.getByText('Rename Layer');
        expect(rename).toHaveAttribute('tabindex', '-1');
        expect(screen.getByText('Show All Layers')).toHaveAttribute('aria-disabled', 'true');
        fireEvent.click(rename);
        fireEvent.click(screen.getByText('Show All Layers'));
        expect(onClick).not.toHaveBeenCalled();
        expect(screen.getByRole('status')).toHaveTextContent('Finish Combo 3');
        fireEvent.click(screen.getByText('Layer 2'));
        expect(onClick).toHaveBeenCalledTimes(1);
        // Closing the editor gives the controls back.
        panels.itemToEdit = null;
        view.rerender(
            <>
                <div data-spotlight-cover=""><button type="button" onClick={onClick}>Rename Layer</button></div>
                <button type="button" data-spotlight-cover="" onClick={onClick}>Show All Layers</button>
                <button type="button" onClick={onClick}>Layer 2</button>
                <BindingSpotlight />
            </>,
        );
        expect(rename).not.toHaveAttribute('tabindex');
        fireEvent.click(rename);
        expect(onClick).toHaveBeenCalledTimes(2);
    });
});
