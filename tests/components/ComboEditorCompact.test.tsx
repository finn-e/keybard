import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BindingEditorContainer from '@/layout/SecondarySidebar/components/BindingEditor/BindingEditorContainer';
import { ComboOptions } from '@/types/keyboard.types';

const state = vi.hoisted(() => ({
    board: {} as any, setKeyboard: vi.fn(), persist: vi.fn(async () => {}), rename: vi.fn(async () => true),
    binding: { selectedTarget: null as any, selectComboKey: vi.fn() },
    panels: { itemToEdit: 0, bindingTypeToEdit: 'combos', initialEditorSlot: null, setPanelToGoBack: vi.fn(), setAlternativeHeader: vi.fn(), handleCloseEditor: vi.fn() },
}));
vi.mock('@/contexts/KeyboardContext', () => ({ useKeyboard: () => ({ keyboard: state.board, setKeyboard: state.setKeyboard }) }));
vi.mock('@/contexts/KeyBindingContext', () => ({ useKeyBinding: () => state.binding }));
vi.mock('@/contexts/PanelsContext', () => ({ usePanels: () => state.panels }));
vi.mock('@/contexts/LayoutSettingsContext', () => ({ useLayoutSettings: () => ({ layoutMode: 'sidebar' }) }));
vi.mock('@/hooks/useBindingChanges', () => ({ useBindingChanges: () => state.persist }));
vi.mock('@/hooks/useBindingNames', () => ({ useBindingNames: () => ({ renameBinding: state.rename, nameError: null }) }));
vi.mock('@/components/Key', () => ({ Key: () => <div /> }));
vi.mock('@/layout/SecondarySidebar/components/BindingEditor/OverrideEditor', () => ({ default: () => <p>Full override editor</p> }));
vi.mock('@/layout/SecondarySidebar/components/BindingEditor/EditorKey', () => ({
    default: ({ keycode, onClick }: { keycode: string; onClick: () => void }) => <button type="button" onClick={onClick}>{keycode}</button>,
}));

describe('compact combo editor', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        state.board = { combos: [{ keys: ['KC_J', 'KC_K', 'KC_NO', 'KC_NO'], output: 'KC_ESC', options: ComboOptions.ENABLED }] };
    });

    it('shows four trigger slots, the output, the enabled toggle, clear and close in one compact editor', () => {
        const close = vi.fn();
        render(<BindingEditorContainer inline compact onRequestClose={close} />);
        for (const n of [1, 2, 3, 4]) expect(screen.getByRole('group', { name: `Trigger key ${n}` })).toBeInTheDocument();
        expect(within(screen.getByRole('group', { name: 'Combo output' })).getByText('KC_ESC')).toBeInTheDocument();
        expect(screen.getByRole('group', { name: 'Combo enabled' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Clear Combo 0' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Combo 0' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Close binding editor' }));
        expect(close).toHaveBeenCalledOnce();
    });

    it('selects the clicked slot so the next keyboard key lands there', () => {
        render(<BindingEditorContainer inline compact />);
        fireEvent.click(within(screen.getByRole('group', { name: 'Trigger key 3' })).getByRole('button'));
        expect(state.binding.selectComboKey).toHaveBeenLastCalledWith(0, 2);
        fireEvent.click(within(screen.getByRole('group', { name: 'Combo output' })).getByRole('button'));
        expect(state.binding.selectComboKey).toHaveBeenLastCalledWith(0, 4);
    });

    it('turns the combo off through the enabled toggle', () => {
        render(<BindingEditorContainer inline compact />);
        fireEvent.click(within(screen.getByRole('group', { name: 'Combo enabled' })).getByRole('button', { name: 'OFF' }));
        const updated = state.setKeyboard.mock.calls[0][0];
        expect(updated.combos[0].options & ComboOptions.ENABLED).toBe(0);
        expect(state.persist).toHaveBeenCalledWith(updated, 'combo', 0);
    });

    it('offers a move handle only when movable, and stacks the title row when asked', () => {
        const view = render(<BindingEditorContainer inline compact movable stacked />);
        expect(view.container.querySelector('[data-float-drag-handle]')).not.toBeNull();
        view.rerender(<BindingEditorContainer inline compact />);
        expect(view.container.querySelector('[data-float-drag-handle]')).toBeNull();
    });

    it('titles a named combo with its name and renames it from the title', async () => {
        state.board.cosmetic = { combos: { '0': 'Dictation' } };
        render(<BindingEditorContainer inline compact />);
        expect(screen.getByRole('heading', { name: 'Dictation' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Rename Dictation' }));
        const input = screen.getByRole('textbox', { name: 'Combo name' });
        expect(input).toHaveValue('Dictation');
        fireEvent.change(input, { target: { value: 'Zoom mute' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(state.rename).toHaveBeenCalledWith('combo', 0, 'Zoom mute');
    });

    it('starts an unnamed combo empty, with its number as the placeholder', () => {
        render(<BindingEditorContainer inline compact />);
        fireEvent.click(screen.getByRole('button', { name: 'Rename Combo 0' }));
        const input = screen.getByRole('textbox', { name: 'Combo name' });
        expect(input).toHaveValue('');
        expect(input).toHaveAttribute('placeholder', 'Combo 0');
    });

    it('keeps the full editor for other binding types', () => {
        state.panels.bindingTypeToEdit = 'overrides';
        state.board = { key_overrides: [] };
        render(<BindingEditorContainer inline compact />);
        expect(screen.getByText('Full override editor')).toBeInTheDocument();
        expect(screen.queryByRole('group', { name: 'Combo keys' })).toBeNull();
        state.panels.bindingTypeToEdit = 'combos';
    });
});
