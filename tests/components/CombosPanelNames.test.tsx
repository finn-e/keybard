// The Combos list shows a named combo's name as a quiet second line, in both
// layouts, and in the row's description. Unnamed rows are unchanged.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CombosPanel from '@/layout/SecondarySidebar/Panels/CombosPanel';
import { ComboOptions } from '@/types/keyboard.types';

const state = vi.hoisted(() => ({ layoutMode: 'sidebar', keyboard: null as any }));
vi.mock('@/contexts/KeyboardContext', () => ({ useKeyboard: () => ({ keyboard: state.keyboard, isConnected: false, setKeyboard: vi.fn() }) }));
vi.mock('@/contexts/ChangesContext', () => ({ useChanges: () => ({ queue: vi.fn() }) }));
vi.mock('@/hooks/useBindingChanges', () => ({ useBindingChanges: () => vi.fn() }));
vi.mock('@/contexts/KeyBindingContext', () => ({ useKeyBinding: () => ({ assignKeycode: vi.fn() }) }));
vi.mock('@/contexts/LayerContext', () => ({ useLayer: () => ({ selectedLayer: 0 }) }));
vi.mock('@/contexts/LayoutSettingsContext', () => ({ useLayoutSettings: () => ({ layoutMode: state.layoutMode, keyVariant: 'default' }) }));
vi.mock('@/contexts/PanelsContext', () => ({ usePanels: () => ({ setItemToEdit: vi.fn(), setBindingTypeToEdit: vi.fn(), setAlternativeHeader: vi.fn(), setInitialEditorSlot: vi.fn() }) }));
vi.mock('@/contexts/ComboPreviewContext', () => ({
    useComboPreview: () => ({
        enabled: true, palette: 'default', focusSet: null, isPinned: () => false,
        enter: vi.fn(), leave: vi.fn(), focusIn: vi.fn(), blurOut: vi.fn(), togglePin: vi.fn(),
    }),
}));
vi.mock('@/components/Key', () => ({ Key: ({ keycode }: { keycode: string }) => <span data-key={keycode} /> }));

const board = () => ({
    keymap: [[4, 5, 13, 14]],
    combos: [
        { cmbid: 0, keys: ['KC_J', 'KC_K', 'KC_NO', 'KC_NO'], output: 'KC_ESC', options: ComboOptions.ENABLED },
        { cmbid: 1, keys: ['KC_D', 'KC_F', 'KC_NO', 'KC_NO'], output: 'KC_ENTER', options: ComboOptions.ENABLED },
    ],
    cosmetic: { combos: { '1': 'Zoom mute' } },
});

afterEach(() => { cleanup(); state.layoutMode = 'sidebar'; });

describe('combo names in the Combos list', () => {
    it.each(['sidebar', 'bottombar'])('%s: a named row shows its name as a second line; others show none', mode => {
        state.layoutMode = mode;
        state.keyboard = board();
        render(<CombosPanel />);
        const names = [...document.querySelectorAll('[data-combo-row-name]')];
        expect(names.map(n => n.textContent)).toEqual(['Zoom mute']);
        expect(names[0].closest('[data-combo-row]')!.getAttribute('data-combo-row')).toBe('1');
        expect(names[0].className).toContain('text-muted-foreground');
        expect(screen.getByRole('button', { name: 'Zoom mute (Combo 1): D plus F gives Enter' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Combo 0: J plus K gives Esc' })).toBeTruthy();
    });

    it('shows nothing extra when no combo is named', () => {
        state.keyboard = { ...board(), cosmetic: {} };
        render(<CombosPanel />);
        expect(document.querySelector('[data-combo-row-name]')).toBeNull();
    });
});
