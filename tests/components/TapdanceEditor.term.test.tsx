import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TapdanceEditor from '@/layout/SecondarySidebar/components/BindingEditor/TapdanceEditor';

const state = vi.hoisted(() => ({
    keyboard: null as any,
    layoutMode: 'sidebar' as 'sidebar' | 'bottombar',
    setKeyboard: vi.fn(),
    persist: vi.fn(async () => {}),
}));
vi.mock('@/contexts/KeyboardContext', () => ({ useKeyboard: () => ({ keyboard: state.keyboard, setKeyboard: state.setKeyboard }) }));
vi.mock('@/hooks/useBindingChanges', () => ({ useBindingChanges: () => state.persist }));
vi.mock('@/contexts/PanelsContext', () => ({ usePanels: () => ({
    setPanelToGoBack: vi.fn(), setAlternativeHeader: vi.fn(), itemToEdit: 0, initialEditorSlot: 'tap',
}) }));
vi.mock('@/contexts/LayoutSettingsContext', () => ({ useLayoutSettings: () => ({ keyVariant: 'medium', layoutMode: state.layoutMode }) }));
vi.mock('@/contexts/KeyBindingContext', () => ({ useKeyBinding: () => ({ selectTapdanceKey: vi.fn(), selectedTarget: null }) }));
vi.mock('@/layout/SecondarySidebar/components/BindingEditor/EditorKey', () => ({ default: () => <div /> }));

const td = (over: Record<string, unknown> = {}) => ({ idx: 0, tap: 'KC_A', hold: 'KC_NO', doubletap: 'KC_NO', taphold: 'KC_NO', tapping_term: 200, enabled: true, ...over });
const input = () => screen.getByRole('spinbutton') as HTMLInputElement;
const written = () => (state.persist.mock.calls.at(-1) as any[])[0].tapdances[0].tapping_term;

describe.each(['sidebar', 'bottombar'] as const)('tap dance term in %s mode', (mode) => {
    beforeEach(() => {
        state.layoutMode = mode;
        state.persist.mockClear();
        state.keyboard = { tapdances: [td()] };
    });

    it('shows the stored term, with a 20 ms minimum', () => {
        render(<TapdanceEditor />);
        expect(input().value).toBe('200');
        expect(input().min).toBe('20');
    });

    it('waits for Enter or blur, then clamps a term below 20 ms to 20', () => {
        render(<TapdanceEditor />);
        fireEvent.change(input(), { target: { value: '1' } });
        expect(input().value).toBe('1');
        expect(state.persist).not.toHaveBeenCalled();
        fireEvent.keyDown(input(), { key: 'Enter' });
        expect(written()).toBe(20);
    });

    it('saves a typed term on blur', () => {
        render(<TapdanceEditor />);
        fireEvent.change(input(), { target: { value: '150' } });
        fireEvent.blur(input());
        expect(written()).toBe(150);
    });

    it('has no on/off toggle', () => {
        render(<TapdanceEditor />);
        expect(screen.queryByRole('switch')).toBeNull();
        expect(screen.queryByText(/^(ON|OFF|Enabled)$/i)).toBeNull();
    });
});
