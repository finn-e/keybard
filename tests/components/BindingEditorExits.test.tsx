import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import SecondarySidebar from '../../src/layout/SecondarySidebar/SecondarySidebar';
import { TooltipProvider } from '../../src/components/ui/tooltip';

const state = vi.hoisted(() => ({
    activePanel: 'combos', state: 'expanded', itemToEdit: 2 as number | null, pickerMode: 'keyboard',
    handleCloseDetails: vi.fn(), setItemToEdit: vi.fn(), handleCloseEditor: vi.fn(), setPickerMode: vi.fn(),
}));
vi.mock('@/components/ui/sidebar', () => ({ useSidebar: () => ({ state: 'collapsed' }) }));
vi.mock('@/contexts/PanelsContext', () => ({ usePanels: () => state }));
vi.mock('@/contexts/KeyboardContext', () => ({ useKeyboard: () => ({ keyboard: null }) }));
vi.mock('../../src/layout/SecondarySidebar/components/BindingEditor/BindingEditorContainer', () => ({
    default: ({ shouldClose }: { shouldClose?: boolean }) => <p data-testid="editor" data-should-close={String(!!shouldClose)}>Editor</p>,
}));
vi.mock('../../src/layout/SecondarySidebar/Panels/AltRepeatPanel', () => ({default: () => <p>AltRepeatPanel</p>}));
vi.mock('../../src/layout/SecondarySidebar/Panels/BasicKeyboards', () => ({default: () => <button type="button">KC_A</button>}));
vi.mock('../../src/layout/SecondarySidebar/Panels/CombosPanel', () => ({default: () => <p>CombosPanel</p>}));
vi.mock('../../src/layout/SecondarySidebar/Panels/DynamicMenuPanel', () => ({default: () => <p>DynamicMenuPanel</p>}));
vi.mock('../../src/layout/SecondarySidebar/Panels/FragmentsPanel', () => ({default: () => <p>FragmentsPanel</p>}));
vi.mock('../../src/layout/SecondarySidebar/Panels/LayoutsPanel', () => ({default: () => <p>LayoutsPanel</p>}));
vi.mock('../../src/layout/SecondarySidebar/Panels/LeadersPanel', () => ({default: () => <p>LeadersPanel</p>}));
vi.mock('../../src/layout/SecondarySidebar/Panels/LayersPanel', () => ({default: () => <p>LayersPanel</p>}));
vi.mock('../../src/layout/SecondarySidebar/Panels/MacrosPanel', () => ({default: () => <p>MacrosPanel</p>}));
vi.mock('../../src/layout/SecondarySidebar/Panels/OverridesPanel', () => ({default: () => <p>OverridesPanel</p>}));
vi.mock('../../src/layout/SecondarySidebar/Panels/PointingPanel', () => ({default: () => <p>PointingPanel</p>}));
vi.mock('../../src/layout/SecondarySidebar/Panels/OneShotComposerPanel', () => ({default: () => <p>OneShotComposerPanel</p>}));
vi.mock('../../src/layout/SecondarySidebar/Panels/QmkKeysPanel', () => ({default: () => <p>QmkKeysPanel</p>}));
vi.mock('../../src/layout/SecondarySidebar/Panels/MousePanel', () => ({default: () => <p>MousePanel</p>}));
vi.mock('../../src/layout/SecondarySidebar/Panels/QMKSettingsPanel', () => ({default: () => <p>QMKSettingsPanel</p>}));
vi.mock('../../src/layout/SecondarySidebar/Panels/ScanLabPanel', () => ({default: () => <p>ScanLabPanel</p>}));
vi.mock('../../src/layout/SecondarySidebar/Panels/TapdancePanel', () => ({default: () => <p>TapdancePanel</p>}));
vi.mock('../../src/layout/SecondarySidebar/Panels/AboutPanel', () => ({default: () => <p>AboutPanel</p>}));
vi.mock('../../src/layout/SecondarySidebar/Panels/QuickStartPanel', () => ({default: () => <p>QuickStartPanel</p>}));
vi.mock('../../src/layout/SecondarySidebar/Panels/SpecialKeysPanel/SpecialKeysPanel', () => ({default: () => <p>SpecialKeysPanel/SpecialKeysPanel</p>}));

beforeAll(() => { vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const closing = () => screen.getByTestId('editor').getAttribute('data-should-close') === 'true';

describe('ways out of a binding editor', () => {
    it.each([false, true])('Done closes the editor (bottom=%s)', bottom => {
        render(<TooltipProvider><SecondarySidebar bottom={bottom} comboPlacement="half" /></TooltipProvider>);
        const done = screen.getAllByRole('button', { name: 'Done' }).find(b => !b.closest('[hidden]'))!;
        fireEvent.click(done);
        if (bottom) expect(state.handleCloseEditor).toHaveBeenCalledTimes(1);
        else expect(closing()).toBe(true);
    });

    it('the back arrow in the picker header closes the editor', () => {
        render(<TooltipProvider><SecondarySidebar comboPlacement="half" /></TooltipProvider>);
        const back = screen.getAllByRole('button', { name: 'Go back' }).find(b => !b.closest('[hidden]'))!;
        fireEvent.click(back);
        expect(closing()).toBe(true);
    });

    it('picker tabs and picker keys never close the editor', () => {
        render(<TooltipProvider><SecondarySidebar comboPlacement="half" /></TooltipProvider>);
        fireEvent.click(screen.getAllByRole('button', { name: 'Pointing Devices' })[0]);
        expect(state.setPickerMode).toHaveBeenCalledWith('pointing');
        fireEvent.click(screen.getAllByRole('button', { name: 'KC_A' })[0]);
        expect(closing()).toBe(false);
        expect(state.handleCloseEditor).not.toHaveBeenCalled();
        expect(state.setItemToEdit).not.toHaveBeenCalled();
    });

    it('offers only the categories this editor can use in the picker tabs', () => {
        state.activePanel = 'tapdances';
        render(<TooltipProvider><SecondarySidebar /></TooltipProvider>);
        expect(screen.queryAllByRole('button', { name: 'Tap Dance Keys' })).toHaveLength(0);
        expect(screen.getAllByRole('button', { name: 'Macro Keys' }).length).toBeGreaterThan(0);
        state.activePanel = 'combos';
    });
});
