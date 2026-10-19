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
const kb = vi.hoisted(() => ({ keyboard: null as null | { cosmetic?: Record<string, Record<string, string>> } }));
vi.mock('@/contexts/KeyboardContext', () => ({ useKeyboard: () => kb }));
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
vi.mock('../../src/layout/SecondarySidebar/Panels/QuickStartPanel', () => ({default: () => <p>QuickStartPanel</p>}));
vi.mock('../../src/layout/SecondarySidebar/Panels/SpecialKeysPanel/SpecialKeysPanel', () => ({default: () => <p>SpecialKeysPanel/SpecialKeysPanel</p>}));

beforeAll(() => { vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }); });
afterEach(() => { cleanup(); vi.clearAllMocks(); state.activePanel = 'combos'; state.itemToEdit = 2; kb.keyboard = null; });

const visibleHeadings = () => screen.getAllByRole('heading', { level: 2 }).filter(h => !h.closest('[hidden], [inert]')).map(h => h.textContent);

describe('picker header while a binding editor is open', () => {
    it.each([
        ['combos', 'Editing Combo 3', 'Combo 3'],
        ['tapdances', 'Editing Tap Dance 3', 'Editing Tap Dance 3'],
        ['macros', 'Editing Macro 3', 'Editing Macro 3'],
        ['overrides', 'Editing Override 3', 'Editing Override 3'],
        ['altrepeat', 'Editing Alt-Repeat 3', 'Editing Alt-Repeat 3'],
        ['leaders', 'Editing Leader 3', 'Editing Leader 3'],
    ])('%s reads "%s" in every placement (its heading: "%s")', (panel, label, heading) => {
        state.activePanel = panel;
        state.itemToEdit = 3;
        for (const placement of ['half', 'dock', 'anchored', 'float', 'panel'] as const) {
            for (const bottom of [false, true]) {
                const { unmount } = render(<TooltipProvider><SecondarySidebar bottom={bottom} comboPlacement={placement} /></TooltipProvider>);
                expect(visibleHeadings()).toEqual([heading]);
                expect(screen.getByRole('complementary', { hidden: true })).toHaveAttribute('aria-label', label);
                unmount();
            }
        }
    });

    it('keeps the editor title on the picker as it leaves, never the old "Add Keys to" title', () => {
        state.activePanel = 'combos';
        state.itemToEdit = 2;
        const view = render(<TooltipProvider><SecondarySidebar comboPlacement="half" /></TooltipProvider>);
        const overlayTitle = () => document.querySelector('[data-picker-overlay] h2')?.textContent;
        expect(overlayTitle()).toBe('Combo 2');
        state.itemToEdit = null;
        view.rerender(<TooltipProvider><SecondarySidebar comboPlacement="half" /></TooltipProvider>);
        expect(overlayTitle()).toBe('Combo 2');
        expect(visibleHeadings()).toEqual(['Combos']);
    });

    it('keeps the panel title when no editor is open', () => {
        state.activePanel = 'tapdances';
        state.itemToEdit = null;
        render(<TooltipProvider><SecondarySidebar /></TooltipProvider>);
        expect(visibleHeadings()).toEqual(['Tap Dance Keys']);
        expect(screen.getByRole('complementary', { hidden: true })).toHaveAttribute('aria-label', 'Tap Dance Keys');
    });

    const subtitles = () => [...document.querySelectorAll('[data-binding-editor-subtitle]')].filter(p => !p.closest('[hidden], [inert]')).map(p => p.textContent);

    it.each([
        ['tapdances', 'tapdances', 'Shift or caps'],
        ['macros', 'macros', 'Email signature'],
    ])('%s shows its custom name under the header', (panel, store, name) => {
        state.activePanel = panel;
        state.itemToEdit = 3;
        kb.keyboard = { cosmetic: { [store]: { '3': name } } };
        for (const placement of ['half', 'panel'] as const) {
            const { unmount } = render(<TooltipProvider><SecondarySidebar comboPlacement={placement} /></TooltipProvider>);
            expect(subtitles()).toEqual([name]);
            expect(visibleHeadings()).toEqual([panel === 'macros' ? 'Editing Macro 3' : 'Editing Tap Dance 3']);
            unmount();
        }
    });

    it('titles a named combo with its name, "Combo N" the small label under it', () => {
        state.activePanel = 'combos';
        state.itemToEdit = 3;
        kb.keyboard = { cosmetic: { combos: { '3': 'Dictation' } } };
        for (const placement of ['half', 'panel'] as const) {
            const { unmount } = render(<TooltipProvider><SecondarySidebar comboPlacement={placement} /></TooltipProvider>);
            expect(visibleHeadings()).toEqual(['Dictation']);
            expect(screen.getByRole('button', { name: 'Dictation, rename Combo 3' })).toBeVisible();
            expect(document.querySelector('[data-combo-number]')).toHaveTextContent('Combo 3');
            expect(document.querySelector('[data-combo-name-prompt]')).toBeNull();
            unmount();
        }
    });

    it('offers "Name this combo" under the number of an unnamed combo', () => {
        state.activePanel = 'combos';
        state.itemToEdit = 3;
        kb.keyboard = { cosmetic: {} };
        render(<TooltipProvider><SecondarySidebar comboPlacement="panel" /></TooltipProvider>);
        expect(visibleHeadings()).toEqual(['Combo 3']);
        expect(screen.getByRole('button', { name: 'Name this combo' })).toBeVisible();
    });

    it.each(['combos', 'tapdances', 'macros', 'overrides', 'altrepeat', 'leaders'])('%s shows no subtitle without a custom name', panel => {
        state.activePanel = panel;
        state.itemToEdit = 3;
        kb.keyboard = { cosmetic: { macros: { '4': 'Other' }, tapdances: { '3': '   ' } } };
        render(<TooltipProvider><SecondarySidebar comboPlacement="panel" /></TooltipProvider>);
        expect(subtitles()).toEqual([]);
    });

    it('shows no subtitle when no editor is open', () => {
        state.activePanel = 'macros';
        state.itemToEdit = null;
        kb.keyboard = { cosmetic: { macros: { '3': 'Email signature' } } };
        render(<TooltipProvider><SecondarySidebar comboPlacement="panel" /></TooltipProvider>);
        expect(document.querySelector('[data-binding-editor-subtitle]')).toBeNull();
    });
});
