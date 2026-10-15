import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import BindingSpotlight from '../../src/layout/BindingSpotlight';
import { nudgeBindingEditor } from '../../src/lib/bindingSpotlight';

const panels = vi.hoisted(() => ({ activePanel: 'combos' as string | null, itemToEdit: 3 as number | null, handleCloseEditor: vi.fn() }));
const binding = vi.hoisted(() => ({ selectedTarget: null as { type: string; [key: string]: unknown } | null, clearSelection: vi.fn() }));
vi.mock('@/contexts/PanelsContext', () => ({ usePanels: () => panels }));
vi.mock('@/contexts/KeyBindingContext', () => ({ useKeyBinding: () => binding }));
const settings = vi.hoisted(() => ({ typing: false }));
vi.mock('@/contexts/SettingsContext', () => ({
    useSettings: () => ({ getSetting: (name: string) => name === 'typing-binds-key' ? settings.typing : undefined }),
}));

beforeEach(() => {
    panels.activePanel = 'combos';
    panels.itemToEdit = 3;
    panels.handleCloseEditor.mockClear();
    binding.selectedTarget = null;
    binding.clearSelection.mockClear();
    settings.typing = false;
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
        expect(back).toHaveAttribute('data-back-cue', 'blocked');
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

    it('leaves Esc to Typing Binds a Key for a slot the person picked', () => {
        settings.typing = true;
        binding.selectedTarget = { type: 'combo', comboId: 3, comboSlot: 1 };
        render(<><div data-editor-slot="" data-testid="slot" /><BindingSpotlight /></>);
        fireEvent.pointerDown(screen.getByTestId('slot'));
        esc();
        expect(panels.handleCloseEditor).not.toHaveBeenCalled();
    });

    it('closes on Esc with only the slot an editor selects on opening', () => {
        for (const typing of [true, false]) {
            settings.typing = typing;
            binding.selectedTarget = { type: 'combo', comboId: 3, comboSlot: 0 };
            render(<BindingSpotlight />);
            esc();
            cleanup();
        }
        expect(panels.handleCloseEditor).toHaveBeenCalledTimes(2);
    });

    it('closes on Esc with a picked slot when Typing Binds a Key is off', () => {
        binding.selectedTarget = { type: 'combo', comboId: 3, comboSlot: 1 };
        render(<><div data-editor-slot="" data-testid="slot" /><BindingSpotlight /></>);
        fireEvent.pointerDown(screen.getByTestId('slot'));
        esc();
        expect(panels.handleCloseEditor).toHaveBeenCalledTimes(1);
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

    describe('the opening cue', () => {
        const steadyBack = () => {
            const back = screen.getByRole('button', { name: 'Go back' });
            vi.spyOn(back, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 10, width: 32, height: 32, right: 42, bottom: 42, x: 10, y: 10, toJSON: () => ({}) } as DOMRect);
            return back;
        };
        const Arrow = () => <button type="button" aria-label="Go back" data-binding-editor-back="" />;

        it('rings the back arrow once when an editor opens, with no callout', async () => {
            panels.itemToEdit = null;
            const view = render(<><Arrow /><BindingSpotlight /></>);
            const back = steadyBack();
            panels.itemToEdit = 3;
            view.rerender(<><Arrow /><BindingSpotlight /></>);
            await waitFor(() => expect(back).toHaveAttribute('data-back-cue', 'precue'));
            expect(back).toHaveClass('binding-back-pulse');
            expect(document.querySelector('[data-binding-back-callout]')).toBeNull();
            expect(screen.getByRole('status')).toHaveTextContent('');
        });

        it('is skipped when going straight from one item to another', async () => {
            panels.itemToEdit = 2;
            const view = render(<><Arrow /><BindingSpotlight /></>);
            const back = steadyBack();
            await waitFor(() => expect(back).toHaveAttribute('data-back-cue', 'precue'));
            back.classList.remove('binding-back-pulse');
            back.removeAttribute('data-back-cue');
            // Close and open the next item right away.
            panels.itemToEdit = null;
            view.rerender(<><Arrow /><BindingSpotlight /></>);
            panels.itemToEdit = 3;
            view.rerender(<><Arrow /><BindingSpotlight /></>);
            await new Promise(r => setTimeout(r, 250));
            expect(back).not.toHaveAttribute('data-back-cue');
        });

        it('gives way to a blocked click: two rings and the callout', async () => {
            render(<><Arrow /><BindingSpotlight /></>);
            const back = steadyBack();
            act(() => nudgeBindingEditor());
            await new Promise(r => setTimeout(r, 150));
            expect(back).toHaveAttribute('data-back-cue', 'blocked');
            expect(document.querySelector('[data-binding-back-callout]')).not.toBeNull();
        });
    });

    it('drops a slot selection when the editor closes, so Esc closes the next one', () => {
        binding.selectedTarget = { type: 'combo', comboId: 3, comboSlot: 1 };
        const view = render(<BindingSpotlight />);
        panels.itemToEdit = null;
        view.rerender(<BindingSpotlight />);
        expect(binding.clearSelection).toHaveBeenCalledTimes(1);
    });

    it('leaves a key selection on the layout alone when the editor closes', () => {
        binding.selectedTarget = { type: 'keyboard', layer: 0, row: 1, col: 2 };
        const view = render(<BindingSpotlight />);
        panels.itemToEdit = null;
        view.rerender(<BindingSpotlight />);
        expect(binding.clearSelection).not.toHaveBeenCalled();
    });

    it('treats a click on empty canvas as a blocked click, but not a click on a key or a tab', () => {
        const onCanvas = vi.fn();
        const onKey = vi.fn();
        render(
            <>
                <div data-spotlight-canvas="" onClick={onCanvas} data-testid="canvas">
                    <div data-testid="empty" />
                    <div data-keycode="KC_A" onClick={onKey}><span data-testid="key">A</span></div>
                    <button type="button" onClick={onKey}>Layer 2</button>
                </div>
                <BindingSpotlight />
            </>,
        );
        fireEvent.click(screen.getByTestId('empty'));
        expect(onCanvas).not.toHaveBeenCalled();
        expect(screen.getByRole('status')).toHaveTextContent('Done with Combo 3?');
        fireEvent.click(screen.getByTestId('key'));
        fireEvent.click(screen.getByText('Layer 2'));
        expect(onKey).toHaveBeenCalledTimes(2);
    });

    it('sets the scrim strength from ?spot while editing', () => {
        window.history.replaceState(null, '', '/?spot=deep');
        const view = render(<BindingSpotlight />);
        expect(document.documentElement.getAttribute('data-spot')).toBe('deep');
        panels.itemToEdit = null;
        view.rerender(<BindingSpotlight />);
        expect(document.documentElement.hasAttribute('data-spot')).toBe(false);
        window.history.replaceState(null, '', '/');
        panels.itemToEdit = 3;
        view.rerender(<BindingSpotlight />);
        expect(document.documentElement.hasAttribute('data-spot')).toBe(false);
    });
});

describe('?railMode=collapse: a click on the scrimmed rail', () => {
    const setSearch = (search: string) => window.history.replaceState(null, '', `/${search}`);
    afterEach(() => setSearch(''));
    const page = () => (
        <>
            <button type="button" aria-label="Go back" data-binding-editor-back="" />
            <div data-picker-rail=""><div data-picker-strip="" /></div>
            <BindingSpotlight />
        </>
    );
    const strip = () => document.querySelector('[data-picker-strip]')!;

    it('rings the back arrow and lights the category strip with its own cue', () => {
        setSearch('?railMode=collapse');
        render(page());
        act(() => nudgeBindingEditor({ x: 20, y: 200 }, 'rail'));
        expect(screen.getByRole('button', { name: 'Go back' })).toHaveClass('binding-back-pulse');
        expect(document.querySelector('[data-binding-back-callout]')).toHaveTextContent('Done with Combo 3? Go back to use the rest.');
        expect(strip()).toHaveClass('picker-strip-cue');
        expect(document.querySelector('[data-picker-strip-callout]')).toHaveTextContent('Pick keys here');
        expect(screen.getByRole('status')).toHaveTextContent('Or pick keys from the categories in the side panel.');
    });

    it('clears both cues after a moment', () => {
        vi.useFakeTimers();
        try {
            setSearch('?railMode=collapse');
            render(page());
            act(() => nudgeBindingEditor(undefined, 'rail'));
            act(() => { vi.advanceTimersByTime(3000); });
            expect(strip()).not.toHaveClass('picker-strip-cue');
            expect(document.querySelector('[data-picker-strip-callout]')).toBeNull();
        } finally { vi.useRealTimers(); }
    });

    it('lights only the back arrow for a click elsewhere, or without the param', () => {
        setSearch('?railMode=collapse');
        const view = render(page());
        act(() => nudgeBindingEditor({ x: 400, y: 300 }));
        expect(strip()).not.toHaveClass('picker-strip-cue');
        expect(document.querySelector('[data-picker-strip-callout]')).toBeNull();
        view.unmount();
        setSearch('');
        render(page());
        act(() => nudgeBindingEditor({ x: 20, y: 200 }, 'rail'));
        expect(screen.getByRole('button', { name: 'Go back' })).toHaveClass('binding-back-pulse');
        expect(strip()).not.toHaveClass('picker-strip-cue');
        expect(document.querySelector('[data-picker-strip-callout]')).toBeNull();
    });
});
