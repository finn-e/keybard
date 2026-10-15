import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import BindingSpotlight from '../../src/layout/BindingSpotlight';
import { nudgeBindingEditor } from '../../src/lib/bindingSpotlight';

const panels = vi.hoisted(() => ({ activePanel: 'combos' as string | null, itemToEdit: 3 as number | null, handleCloseEditor: vi.fn() }));
const binding = vi.hoisted(() => ({ selectedTarget: null as object | null }));
vi.mock('@/contexts/PanelsContext', () => ({ usePanels: () => panels }));
vi.mock('@/contexts/KeyBindingContext', () => ({ useKeyBinding: () => binding }));

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

    it('does not exit on a scrim click: it pulses the back arrow and points to it', () => {
        render(<><button type="button" aria-label="Go back" data-binding-editor-back="" /><BindingSpotlight /></>);
        fireEvent.click(document.querySelector('[data-binding-scrim]')!, { clientX: 100, clientY: 200 });
        expect(panels.handleCloseEditor).not.toHaveBeenCalled();
        expect(screen.getByRole('status')).toHaveTextContent('Done with Combo 3? Go back to use the rest.');
        const back = screen.getByRole('button', { name: 'Go back' });
        expect(back).toHaveClass('binding-back-pulse');
        expect(back).toHaveAttribute('data-back-pulse', 'ring');
        const callout = document.querySelector('[data-binding-back-callout]')!;
        expect(callout).toHaveAttribute('data-binding-back-callout', 'arrow');
        expect(callout).toHaveTextContent('Done with Combo 3? Go back to use the rest.');
    });

    it('pulses only the visible back arrow, never a hidden header', () => {
        render(
            <>
                <div hidden><button type="button" aria-label="Hidden back" data-binding-editor-back="" /></div>
                <button type="button" aria-label="Go back" data-binding-editor-back="" />
                <BindingSpotlight />
            </>,
        );
        act(() => nudgeBindingEditor());
        expect(screen.getByRole('button', { name: 'Go back' })).toHaveClass('binding-back-pulse');
        expect(document.querySelector('[aria-label="Hidden back"]')).not.toHaveClass('binding-back-pulse');
    });

    it('pulses the back arrow on screen, not an earlier copy inside a display: none layout', () => {
        render(
            <>
                <div><button type="button" aria-label="Off-screen back" data-binding-editor-back="" /></div>
                <button type="button" aria-label="Go back" data-binding-editor-back="" />
                <BindingSpotlight />
            </>,
        );
        const shown = screen.getByRole('button', { name: 'Go back' });
        const rects = vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) {
            return (this === shown ? [{}] : []) as unknown as DOMRectList;
        });
        try {
            act(() => nudgeBindingEditor());
            expect(shown).toHaveClass('binding-back-pulse');
            expect(document.querySelector('[aria-label="Off-screen back"]')).not.toHaveClass('binding-back-pulse');
        } finally {
            rects.mockRestore();
        }
    });

    it.each(['ring', 'glow', 'nudge'])('uses the ?backPulse=%s style, with the same callout', style => {
        window.history.replaceState(null, '', `/?backPulse=${style}`);
        render(<><button type="button" aria-label="Go back" data-binding-editor-back="" /><BindingSpotlight /></>);
        act(() => nudgeBindingEditor());
        expect(screen.getByRole('button', { name: 'Go back' })).toHaveAttribute('data-back-pulse', style);
        expect(document.querySelector('[data-binding-back-callout]')).toHaveTextContent('Done with Combo 3? Go back to use the rest.');
        window.history.replaceState(null, '', '/');
    });

    it('clears the pulse and the callout after a moment', () => {
        vi.useFakeTimers();
        try {
            render(<><button type="button" aria-label="Go back" data-binding-editor-back="" /><BindingSpotlight /></>);
            act(() => nudgeBindingEditor());
            act(() => { vi.advanceTimersByTime(3000); });
            expect(screen.getByRole('button', { name: 'Go back' })).not.toHaveClass('binding-back-pulse');
            expect(document.querySelector('[data-binding-back-callout]')).toBeNull();
            expect(screen.getByRole('status')).toHaveTextContent('');
        } finally {
            vi.useRealTimers();
        }
    });

    it('names the editor kind and number in the callout', () => {
        panels.activePanel = 'tapdances';
        panels.itemToEdit = 2;
        render(<BindingSpotlight />);
        act(() => nudgeBindingEditor());
        expect(screen.getByRole('status')).toHaveTextContent('Done with Tap Dance 2? Go back to use the rest.');
        // With no back arrow on screen the callout sits near the click instead.
        expect(document.querySelector('[data-binding-back-callout]')).toHaveAttribute('data-binding-back-callout', 'point');
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
        expect(screen.getByRole('status')).toHaveTextContent('Done with Combo 3?');
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
