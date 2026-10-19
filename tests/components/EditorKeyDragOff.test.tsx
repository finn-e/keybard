import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DragProvider, useDrag } from '@/contexts/DragContext';
import { blankKeyOnDrop } from '@/layout/blank-key-drop';
import ComboEditor from '@/layout/SecondarySidebar/components/BindingEditor/ComboEditor';
import EditorKey from '@/layout/SecondarySidebar/components/BindingEditor/EditorKey';

const state = vi.hoisted(() => ({
    board: {} as any, setKeyboard: vi.fn(), persist: vi.fn(async () => {}),
    binding: { selectedTarget: null as any, selectComboKey: vi.fn() },
    panels: { itemToEdit: 0, initialEditorSlot: null, setPanelToGoBack: vi.fn(), setAlternativeHeader: vi.fn() },
}));
vi.mock('@/contexts/KeyboardContext', () => ({ useKeyboard: () => ({ keyboard: state.board, setKeyboard: state.setKeyboard }) }));
vi.mock('@/contexts/KeyBindingContext', () => ({ useKeyBinding: () => state.binding }));
vi.mock('@/contexts/PanelsContext', () => ({ usePanels: () => state.panels }));
vi.mock('@/contexts/LayerContext', () => ({ useLayer: () => ({ selectedLayer: 0 }) }));
vi.mock('@/contexts/LayoutSettingsContext', () => ({ useLayoutSettings: () => ({ layoutMode: 'sidebar' }) }));
vi.mock('@/hooks/useBindingChanges', () => ({ useBindingChanges: () => state.persist }));
vi.mock('@/utils/keys', () => ({
    getKeyContents: (_kb: unknown, keycode: string) => ({ type: 'basic', str: keycode, top: keycode === 'KC_NO' ? 'KC_NO' : keycode }),
}));
// A stand-in Key that starts a drag the way useKeyDrag does, merging dragItemData.
vi.mock('@/components/Key', () => ({
    Key: ({ keycode, dragItemData }: { keycode: string; dragItemData?: object }) => {
        const { startDrag } = useDrag();
        return (
            <button type="button" onMouseDown={(e) => startDrag({ keycode, label: keycode, type: 'basic', ...dragItemData }, e)}>
                {keycode}
            </button>
        );
    },
}));

const slot = (name: string) => within(screen.getByRole('group', { name })).getByRole('button', { name: /^KC_/ });

const renderCombo = (assign = vi.fn()) => {
    render(
        <DragProvider onUnhandledDrop={blankKeyOnDrop(assign)}>
            <ComboEditor />
        </DragProvider>,
    );
    return assign;
};

describe('dragging a combo slot off the editor', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        state.board = { combos: [{ keys: ['KC_J', 'KC_K', 'KC_NO', 'KC_NO'], output: 'KC_ESC', options: 0 }] };
    });

    it('blanks a trigger key dropped into blank space', async () => {
        const assign = renderCombo();
        fireEvent.mouseDown(slot('Trigger key 2'));
        fireEvent.mouseUp(window);
        await act(async () => { vi.runAllTimers(); });
        const updated = state.setKeyboard.mock.calls.at(-1)![0];
        expect(updated.combos[0].keys).toEqual(['KC_J', 'KC_NO', 'KC_NO', 'KC_NO']);
        expect(updated.combos[0].output).toBe('KC_ESC');
        expect(state.persist).toHaveBeenCalledWith(updated, 'combo', 0);
        expect(assign).not.toHaveBeenCalled();
    });

    it('blanks the output dropped into blank space', async () => {
        renderCombo();
        fireEvent.mouseDown(slot('Combo output'));
        fireEvent.mouseUp(window);
        await act(async () => { vi.runAllTimers(); });
        expect(state.setKeyboard.mock.calls.at(-1)![0].combos[0].output).toBe('KC_NO');
    });

    it('still swaps when dropped onto another slot', async () => {
        renderCombo();
        fireEvent.mouseDown(slot('Trigger key 1'));
        const target = slot('Trigger key 3').parentElement!;
        fireEvent.mouseEnter(target);
        fireEvent.mouseUp(target);
        fireEvent.mouseUp(window);
        await act(async () => { vi.runAllTimers(); });
        expect(state.setKeyboard).toHaveBeenCalledOnce();
        expect(state.setKeyboard.mock.calls[0][0].combos[0].keys).toEqual(['KC_NO', 'KC_K', 'KC_J', 'KC_NO']);
    });

    it('does nothing for an empty slot', async () => {
        renderCombo();
        fireEvent.mouseDown(slot('Trigger key 4'));
        fireEvent.mouseUp(window);
        await act(async () => { vi.runAllTimers(); });
        expect(state.setKeyboard).not.toHaveBeenCalled();
    });
});

describe('EditorKey drag-off opt-out', () => {
    beforeEach(() => { vi.clearAllMocks(); state.board = {}; });

    it('leaves the slot alone when clearOnDragOff is false', () => {
        const onClear = vi.fn();
        render(
            <DragProvider onUnhandledDrop={blankKeyOnDrop(vi.fn())}>
                <EditorKey keycode="KC_A" onClick={vi.fn()} onClear={onClear} clearOnDragOff={false} />
            </DragProvider>,
        );
        fireEvent.mouseDown(screen.getByRole('button', { name: 'KC_A' }));
        fireEvent.mouseUp(window);
        expect(onClear).not.toHaveBeenCalled();
    });

    it('clears through onClear by default', () => {
        const onClear = vi.fn();
        render(
            <DragProvider onUnhandledDrop={blankKeyOnDrop(vi.fn())}>
                <EditorKey keycode="KC_A" onClick={vi.fn()} onClear={onClear} />
            </DragProvider>,
        );
        fireEvent.mouseDown(screen.getByRole('button', { name: 'KC_A' }));
        fireEvent.mouseUp(window);
        expect(onClear).toHaveBeenCalledOnce();
    });
});
