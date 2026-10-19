import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TapdancePanel from '@/layout/SecondarySidebar/Panels/TapdancePanel';

const panels = vi.hoisted(() => ({
    setItemToEdit: vi.fn(), setBindingTypeToEdit: vi.fn(),
    setAlternativeHeader: vi.fn(), setPanelToGoBack: vi.fn(), setInitialEditorSlot: vi.fn(),
}));
const assignKeycode = vi.hoisted(() => vi.fn());
const layout = vi.hoisted(() => ({ layoutMode: 'bottombar' }));
vi.mock('@/components/Key', () => ({ Key: (p: { keycode: string; onClick?: () => void }) => <button type="button" data-keycode={p.keycode} onClick={p.onClick}>{p.keycode}</button> }));
vi.mock('@/contexts/PanelsContext', () => ({ usePanels: () => panels }));
vi.mock('@/contexts/KeyboardContext', () => ({ useKeyboard: () => ({ keyboard: {
    tapdances: [
        { tap: 'KC_A', hold: 'KC_LSFT', doubletap: 'KC_NO', taphold: 'KC_NO' },
        { tap: 'KC_NO', hold: 'KC_NO', doubletap: 'KC_NO', taphold: 'KC_NO' },
    ],
} }) }));
vi.mock('@/contexts/LayerContext', () => ({ useLayer: () => ({ selectedLayer: 0 }) }));
vi.mock('@/contexts/KeyBindingContext', () => ({ useKeyBinding: () => ({ assignKeycode }) }));
vi.mock('@/contexts/LayoutSettingsContext', () => ({ useLayoutSettings: () => layout }));
vi.mock('@/utils/keys', () => ({ getKeyContents: (_kb: unknown, code: string) => ({ top: code, str: code === 'KC_NO' ? '' : code }) }));

beforeEach(() => { vi.clearAllMocks(); });

describe('tap dance keys as a picker', () => {
    it('puts the tap dance in the slot and never opens another editor (bottom bar)', () => {
        layout.layoutMode = 'bottombar';
        render(<TapdancePanel isPicker />);
        expect(screen.queryByRole('button', { name: 'Add new tap dance' })).not.toBeInTheDocument();
        fireEvent.click(screen.getByText('Tap Dance 0'));
        expect(assignKeycode).toHaveBeenCalledWith('TD(0)');
        expect(panels.setItemToEdit).not.toHaveBeenCalled();
    });

    it('lists the tap dances without edit actions in the sidebar', () => {
        layout.layoutMode = 'sidebar';
        const { container } = render(<TapdancePanel isPicker />);
        expect(screen.getByText('Tap Dance Keys')).toBeInTheDocument();
        // A slot key in a row picks its tap dance instead of opening it.
        fireEvent.click(container.querySelector('[data-keycode="KC_LSFT"]')!);
        expect(assignKeycode).toHaveBeenCalledWith('TD(0)');
        expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
        expect(panels.setItemToEdit).not.toHaveBeenCalled();
    });
});
