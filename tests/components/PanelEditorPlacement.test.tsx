import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { pinnedEditorTop } from '../../src/lib/comboEditorPlacement';
import SecondarySidebar from '../../src/layout/SecondarySidebar/SecondarySidebar';
import { TooltipProvider } from '../../src/components/ui/tooltip';

const state = vi.hoisted(() => ({
    activePanel: 'combos', state: 'expanded', itemToEdit: 2 as number | null, pickerMode: 'keyboard' as string,
    handleCloseDetails: vi.fn(), setItemToEdit: vi.fn(), handleCloseEditor: vi.fn(), setPickerMode: vi.fn(),
}));
vi.mock('@/components/ui/sidebar', () => ({ useSidebar: () => ({ state: 'collapsed' }) }));
vi.mock('@/contexts/PanelsContext', () => ({ usePanels: () => state }));
vi.mock('@/contexts/KeyboardContext', () => ({ useKeyboard: () => ({ keyboard: null }) }));
vi.mock('../../src/layout/SecondarySidebar/components/BindingEditor/BindingEditorContainer', () => ({
    default: ({ shouldClose, bar }: { shouldClose?: boolean; bar?: boolean }) => <p data-testid="editor" data-bar={String(!!bar)} data-should-close={String(!!shouldClose)}>Editor</p>,
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
beforeEach(() => { state.activePanel = 'combos'; state.itemToEdit = 2; state.pickerMode = 'keyboard'; });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const ui = (props: Record<string, unknown> = {}) => <TooltipProvider><SecondarySidebar comboPlacement="panel" {...props} /></TooltipProvider>;
const panel = (c: HTMLElement) => c.querySelector('aside.detail-panel') as HTMLElement;
const scroller = (c: HTMLElement) => c.querySelector('[data-panel-editor-scroll]') as HTMLElement;
const workspaces = (c: HTMLElement) => [...c.querySelectorAll('.binding-workspace')] as HTMLElement[];

describe('binding editor in the side panel', () => {
    it.each(['combos', 'tapdances', 'macros', 'overrides', 'altrepeat', 'leaders'])('pins the %s editor at the top of the panel, above the picker', editor => {
        state.activePanel = editor;
        const { container } = render(ui());
        expect(panel(container)).toHaveAttribute('data-editor-placement', 'panel');
        const [ws] = workspaces(container);
        expect(ws.parentElement).toBe(scroller(container));
        expect(scroller(container).firstElementChild).toBe(ws);
        expect(ws).toHaveClass('sticky');
        expect(ws.style.top).toBe('0px');
        const pickerKey = within(scroller(container)).getByRole('button', { name: 'KC_A' });
        expect(ws.compareDocumentPosition(pickerKey) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(within(ws).getByTestId('editor')).toBeInTheDocument();
    });

    it('puts no editor card over the layout', () => {
        const { container } = render(ui());
        expect(workspaces(container)).toHaveLength(1);
        expect(panel(container)).not.toHaveAttribute('data-combo-placement');
        expect(workspaces(container)[0]).not.toHaveAttribute('data-combo-placement');
        expect(workspaces(container)[0].closest('aside')).toBe(panel(container));
    });

    it('swaps only the picker when another rail category is chosen', () => {
        const view = render(ui());
        const before = workspaces(view.container)[0];
        state.pickerMode = 'special';
        view.rerender(ui());
        const sc = scroller(view.container);
        expect(within(sc).getByText('SpecialKeysPanel/SpecialKeysPanel')).toBeInTheDocument();
        expect(within(sc).queryByRole('button', { name: 'KC_A' })).toBeNull();
        expect(workspaces(view.container)[0]).toBe(before);
        expect(sc.firstElementChild).toBe(before);
        expect(state.handleCloseEditor).not.toHaveBeenCalled();
        expect(state.setItemToEdit).not.toHaveBeenCalled();
    });

    it.each(['combos', 'tapdances', 'macros', 'overrides', 'altrepeat', 'leaders'])('shows the %s editor as the compact bar, with no X: the back arrow closes it', editor => {
        state.activePanel = editor;
        render(ui());
        const ws = document.querySelector('.binding-workspace') as HTMLElement;
        expect(within(ws).getByTestId('editor')).toHaveAttribute('data-bar', 'true');
        expect(within(ws).queryByRole('button', { name: 'Close binding editor' })).toBeNull();
        const back = screen.getAllByRole('button', { name: 'Go back' }).find(b => !b.closest('[hidden]'))!;
        expect(back).toHaveAttribute('data-binding-editor-back');
        fireEvent.click(back);
        expect(screen.getByTestId('editor')).toHaveAttribute('data-should-close', 'true');
    });

    it('keeps the close button in the other placements', () => {
        state.activePanel = 'tapdances';
        render(ui({ comboPlacement: 'half' }));
        expect(screen.getByRole('button', { name: 'Close binding editor' })).toBeInTheDocument();
        expect(screen.getByTestId('editor')).toHaveAttribute('data-bar', 'false');
    });

    it('returns to the list scrolled where the edited item was', async () => {
        state.itemToEdit = null;
        const view = render(ui());
        const list = view.container.querySelector('[data-panel-scroll-owner]') as HTMLElement;
        list.scrollTop = 320;
        fireEvent.scroll(list);
        state.itemToEdit = 7;
        view.rerender(ui());
        // The list stays laid out for the entering motion, then hides.
        await waitFor(() => expect(list.querySelector('[hidden]')).not.toBeNull());
        list.scrollTop = 0; // hiding the list resets its scroll
        fireEvent.scroll(list);
        state.itemToEdit = null;
        view.rerender(ui());
        expect(workspaces(view.container)).toHaveLength(0);
        expect(list.querySelector('[hidden]')).toBeNull();
        expect(within(list).getByText('CombosPanel')).toBeInTheDocument();
        expect(list.scrollTop).toBe(320);
    });

    it('leaves the other placements and the bottom bar as they were', () => {
        state.activePanel = 'tapdances';
        const half = render(ui({ comboPlacement: 'half' }));
        expect(panel(half.container)).not.toHaveAttribute('data-editor-placement');
        expect(workspaces(half.container)[0].parentElement).toBe(panel(half.container));
        cleanup();
        const bottom = render(ui({ bottom: true }));
        expect(panel(bottom.container)).not.toHaveAttribute('data-editor-placement');
        expect(scroller(bottom.container)).toBeNull();
    });
});

describe('pinned editor top', () => {
    it('pins a short editor at the top', () => {
        expect(pinnedEditorTop(800, 120)).toBe(0);
        expect(pinnedEditorTop(800, 580)).toBe(0);
    });

    it('lets a tall editor scroll up just enough to keep picker room below it', () => {
        expect(pinnedEditorTop(800, 900)).toBe(800 - 220 - 900);
        expect(pinnedEditorTop(400, 500)).toBe(400 - 160 - 500);
    });

    it('stays at 0 before anything is measured', () => {
        expect(pinnedEditorTop(0, 300)).toBe(0);
        expect(pinnedEditorTop(800, 0)).toBe(0);
    });
});
