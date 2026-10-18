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
    it.each([false, true])('the back arrow in the picker header closes the editor (bottom=%s)', bottom => {
        render(<TooltipProvider><SecondarySidebar bottom={bottom} comboPlacement="half" /></TooltipProvider>);
        const back = screen.getAllByRole('button', { name: 'Go back' }).find(b => !b.closest('[hidden]'))!;
        expect(back).toHaveAttribute('data-binding-editor-back');
        fireEvent.click(back);
        if (bottom) expect(state.handleCloseEditor).toHaveBeenCalledTimes(1);
        else expect(closing()).toBe(true);
    });

    it('has no Done button: the back arrow is the way out', () => {
        render(<TooltipProvider><SecondarySidebar comboPlacement="half" /></TooltipProvider>);
        expect(screen.queryAllByRole('button', { name: 'Done' })).toHaveLength(0);
    });

    it('picker keys never close the editor', () => {
        render(<TooltipProvider><SecondarySidebar comboPlacement="half" /></TooltipProvider>);
        fireEvent.click(screen.getAllByRole('button', { name: 'KC_A' })[0]);
        expect(closing()).toBe(false);
        expect(state.handleCloseEditor).not.toHaveBeenCalled();
        expect(state.setItemToEdit).not.toHaveBeenCalled();
    });

    it.each([false, true])('has no category strip of its own: the rail switches the picker (bottom=%s)', bottom => {
        render(<TooltipProvider><SecondarySidebar bottom={bottom} comboPlacement="half" /></TooltipProvider>);
        expect(document.querySelector('[data-picker-rail]')).toBeNull();
        expect(document.querySelector('[data-picker-strip]')).toBeNull();
        expect(screen.queryAllByRole('button', { name: 'Pointing Devices' })).toHaveLength(0);
    });
});

describe('?railMode=collapse: the rail is under the scrim, so the panel keeps its category strip', () => {
    afterEach(() => { window.history.replaceState(null, '', '/'); state.activePanel = 'combos'; });

    it('picker tabs switch the picker and never close the editor', () => {
        window.history.replaceState(null, '', '/?railMode=collapse');
        render(<TooltipProvider><SecondarySidebar comboPlacement="half" /></TooltipProvider>);
        expect(document.querySelector('[data-picker-rail] [data-picker-strip]')).not.toBeNull();
        fireEvent.click(screen.getAllByRole('button', { name: 'Pointing Devices' })[0]);
        expect(state.setPickerMode).toHaveBeenCalledWith('pointing');
        expect(closing()).toBe(false);
        expect(state.handleCloseEditor).not.toHaveBeenCalled();
    });

    it('offers only the categories this editor can use in the picker tabs', () => {
        window.history.replaceState(null, '', '/?railMode=collapse');
        state.activePanel = 'tapdances';
        render(<TooltipProvider><SecondarySidebar /></TooltipProvider>);
        expect(screen.queryAllByRole('button', { name: 'Tap Dance Keys' })).toHaveLength(0);
        expect(screen.getAllByRole('button', { name: 'Macro Keys' }).length).toBeGreaterThan(0);
    });
});

describe('?railMode=modal: the panel while the rail is the selector and the way out', () => {
    afterEach(() => window.history.replaceState(null, '', '/'));

    it.each(['panel', 'half'] as const)('drops its category strip and back arrow, keeping the heading (%s)', placement => {
        window.history.replaceState(null, '', '/?railMode=modal');
        render(<TooltipProvider><SecondarySidebar comboPlacement={placement} /></TooltipProvider>);
        expect(document.querySelector('[data-picker-rail]')).toBeNull();
        expect(document.querySelector('[data-picker-strip]')).toBeNull();
        expect(screen.queryAllByRole('button', { name: 'Go back' })).toHaveLength(0);
        expect(document.querySelector('[data-binding-editor-back]')).toBeNull();
        // A combo's heading is its name, or its number while it has none.
        expect(screen.getAllByRole('heading', { name: 'Combo 2' }).length).toBeGreaterThan(0);
    });

    it('keeps the back arrow without the param', () => {
        render(<TooltipProvider><SecondarySidebar comboPlacement="panel" /></TooltipProvider>);
        expect(screen.getAllByRole('button', { name: 'Go back' }).length).toBeGreaterThan(0);
    });
});
