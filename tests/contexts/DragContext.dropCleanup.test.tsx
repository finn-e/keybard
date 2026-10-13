import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import { DragProvider, useDrag, type DragItem } from '../../src/contexts/DragContext';

const item: DragItem = { keycode: 'KC_A', label: 'A', type: 'key', sourceId: 'key-0' };

let drag: ReturnType<typeof useDrag> | null = null;
const Probe = () => {
    drag = useDrag();
    return drag.isDragging ? <div data-testid="ghost">{drag.draggedItem?.label}</div> : null;
};
const tree = (onUnhandledDrop: (i: DragItem, e: MouseEvent) => void) => (
    <DragProvider onUnhandledDrop={onUnhandledDrop}><Probe /></DragProvider>
);

// Regression: EditorLayout rebuilds onUnhandledDrop whenever the keymap
// changes. Dropping onto a key changes the keymap, which used to tear down
// the provider's window listeners, so the ghost tile stayed on screen.
describe('drag cleanup when the drop handler changes mid-drag', () => {
    it('clears the ghost after a drop consumed by a key', () => {
        const { rerender, queryByTestId } = render(tree(vi.fn()));
        act(() => drag!.startDrag(item, new MouseEvent('mousedown', { clientX: 5, clientY: 5 })));
        expect(queryByTestId('ghost')).not.toBeNull();
        act(() => drag!.markDropConsumed());
        const laterHandler = vi.fn();
        rerender(tree(laterHandler));
        fireEvent.mouseMove(window, { clientX: 40, clientY: 50 });
        expect(drag!.dragPosition).toEqual({ x: 40, y: 50 });
        fireEvent.mouseUp(window);
        expect(queryByTestId('ghost')).toBeNull();
        expect(drag!.isDragging).toBe(false);
        expect(laterHandler).not.toHaveBeenCalled();
    });

    it('runs the current unhandled-drop handler for a drop on blank space', () => {
        const first = vi.fn();
        const { rerender, queryByTestId } = render(tree(first));
        act(() => drag!.startDrag(item, new MouseEvent('mousedown')));
        const latest = vi.fn();
        rerender(tree(latest));
        fireEvent.mouseUp(window);
        expect(queryByTestId('ghost')).toBeNull();
        expect(first).not.toHaveBeenCalled();
        expect(latest).toHaveBeenCalledTimes(1);
    });

    it('Escape still cancels after the handler changes', () => {
        const { rerender, queryByTestId } = render(tree(vi.fn()));
        act(() => drag!.startDrag(item, new MouseEvent('mousedown')));
        const latest = vi.fn();
        rerender(tree(latest));
        fireEvent.keyDown(window, { key: 'Escape' });
        fireEvent.mouseUp(window);
        expect(queryByTestId('ghost')).toBeNull();
        expect(latest).not.toHaveBeenCalled();
    });
});
