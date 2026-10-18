import { fireEvent, render, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChangesProvider } from '@/contexts/ChangesContext';
import OverrideEditor from '@/layout/SecondarySidebar/components/BindingEditor/OverrideEditor';

// QMK key override option bits (quantum/process_keycode/process_key_override.h)
// plus the Svalboard enabled flag (modules/svalboard/core/sval.h, bit 7).
const ALL_ACTIVATIONS = 0x07;
const ENABLED = 0x80;
const LSFT = 0x02;
const LCTL = 0x01;

const state = vi.hoisted(() => ({
    board: {} as any,
    setKeyboard: vi.fn((kb: any) => { state.board = kb; }),
    binding: { selectedTarget: null as any, selectOverrideKey: vi.fn(), clearSelection: vi.fn() },
    panels: { itemToEdit: 0, initialEditorSlot: null, setPanelToGoBack: vi.fn(), setAlternativeHeader: vi.fn() },
    service: { saveSvil: vi.fn(async () => {}), updateKeyoverride: vi.fn(async () => {}) },
}));
vi.mock('@/contexts/KeyboardContext', () => ({ useKeyboard: () => ({ keyboard: state.board, setKeyboard: state.setKeyboard, getKeyboardSnapshot: () => state.board }) }));
vi.mock('@/contexts/KeyBindingContext', () => ({ useKeyBinding: () => state.binding }));
vi.mock('@/contexts/PanelsContext', () => ({ usePanels: () => state.panels }));
vi.mock('@/contexts/SettingsContext', () => ({ useSettings: () => ({ getSetting: () => false, updateSetting: vi.fn() }) }));
vi.mock('@/services/keyboard.service', () => ({ keyboardService: state.service }));
vi.mock('@/layout/SecondarySidebar/components/BindingEditor/EditorKey', () => ({ default: () => <div /> }));
vi.mock('@/layout/SecondarySidebar/components/BindingEditor/OverrideModifierSelector', () => ({
    default: ({ value, onChange }: { value: number; onChange: (m: number) => void }) => (
        <div>
            <span data-testid="mask">{value}</span>
            <button onClick={() => onChange(LSFT)}>set shift</button>
            <button onClick={() => onChange(LSFT | LCTL)}>set shift ctrl</button>
            <button onClick={() => onChange(LCTL)}>set ctrl</button>
        </div>
    ),
}));

const blank = () => ({ koid: 0, trigger: 'KC_NO', replacement: 'KC_NO', options: 0, layers: 0, trigger_mods: 0, negative_mod_mask: 0, suppressed_mods: 0 });
const ko = () => state.board.key_overrides[0];
const renderEditor = () => render(<ChangesProvider><OverrideEditor /></ChangesProvider>);

describe('new key override defaults', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        state.board = { layers: 4, key_overrides: [blank()] };
    });

    it('starts enabled, with the QMK default activations, on every layer the board has', () => {
        const view = renderEditor();
        fireEvent.click(view.getByText('set shift'));
        expect(ko().options).toBe(ENABLED | ALL_ACTIVATIONS);
        expect(ko().layers).toBe(0b1111);
    });

    it('hides the trigger mods by default, so Shift + Bksp -> Del sends a plain Del', () => {
        const view = renderEditor();
        fireEvent.click(view.getByText('set shift'));
        expect(ko().trigger_mods).toBe(LSFT);
        expect(ko().suppressed_mods).toBe(LSFT);
        fireEvent.click(view.getByText('set shift ctrl'));
        expect(ko().suppressed_mods).toBe(LSFT | LCTL);
    });

    it('stops following the trigger mods once suppressed mods are edited', () => {
        const view = renderEditor();
        fireEvent.click(view.getByText('set shift ctrl'));
        fireEvent.click(view.getByRole('button', { name: 'Suppressed' }));
        fireEvent.click(view.getByText('set ctrl'));
        expect(ko().suppressed_mods).toBe(LCTL);
        fireEvent.click(view.getByRole('button', { name: 'Trigger' }));
        fireEvent.click(view.getByText('set shift'));
        expect(ko().trigger_mods).toBe(LSFT);
        expect(ko().suppressed_mods).toBe(LCTL);
    });

    it('leaves an existing override alone', () => {
        state.board.key_overrides[0] = { ...blank(), trigger: 'KC_BSPC', replacement: 'KC_DEL', trigger_mods: LSFT, options: ALL_ACTIVATIONS, layers: 1 };
        const view = renderEditor();
        fireEvent.click(view.getByText('set shift ctrl'));
        expect(ko().options).toBe(ALL_ACTIVATIONS);
        expect(ko().layers).toBe(1);
        expect(ko().suppressed_mods).toBe(0);
    });
});

describe('key override option labels', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        state.board = { layers: 4, key_overrides: [{ ...blank(), trigger: 'KC_BSPC', options: ENABLED | ALL_ACTIVATIONS }] };
    });
    const isOn = (view: ReturnType<typeof renderEditor>, label: string) =>
        within(view.getByRole('group', { name: label })).getByRole('button', { name: 'ON' }).getAttribute('aria-pressed') === 'true';

    it('names each option by what it does', () => {
        const view = renderEditor();
        for (const label of ['Activate on Trigger Down', 'Activate on Mod Down', 'Activate on Negative Mod Up', 'Any One Trigger Mod', 'Re-press Trigger Key', 'Stay Active on Other Keys']) {
            expect(view.getByRole('group', { name: label })).toBeTruthy();
        }
        expect(view.getByRole('button', { name: 'Suppressed' })).toBeTruthy();
        expect(view.queryByText('Suspended')).toBeNull();
    });

    it('shows Re-press Trigger Key as on when the no-reregister bit is clear, and sets that bit when turned off', () => {
        const view = renderEditor();
        expect(isOn(view, 'Re-press Trigger Key')).toBe(true);
        fireEvent.click(within(view.getByRole('group', { name: 'Re-press Trigger Key' })).getByRole('button', { name: 'OFF' }));
        expect(ko().options & 0x10).toBe(0x10);
        expect(isOn(view, 'Any One Trigger Mod')).toBe(false);
    });
});
