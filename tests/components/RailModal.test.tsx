import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { SidebarProvider } from '../../src/components/ui/sidebar';
import { TooltipProvider } from '../../src/components/ui/tooltip';
import { PanelsProvider, usePanels } from '../../src/contexts/PanelsContext';
import BindingSpotlight from '../../src/layout/BindingSpotlight';
import AppSidebar from '../../src/layout/Sidebar';
import { railModeFrom } from '../../src/lib/bindingSpotlight';

vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));
vi.mock('@/contexts/KeyboardContext', () => ({ useKeyboard: () => ({ keyboard: null }) }));
vi.mock('@/contexts/SettingsContext', () => ({ useSettings: () => ({ getSetting: () => false }) }));
vi.mock('@/contexts/KeyBindingContext', () => ({ useKeyBinding: () => ({ selectedTarget: null, clearSelection: vi.fn() }) }));
vi.mock('@/features/trainer/OverlayDialog', () => ({ OverlayDialog: () => null, overlayRequested: () => false }));

beforeAll(() => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
const clearCookie = () => { document.cookie = 'primary-nav:state=; path=/; max-age=0'; };
const setSearch = (search: string) => window.history.replaceState(null, '', `/${search}`);
beforeEach(clearCookie);
afterEach(() => { cleanup(); clearCookie(); setSearch(''); });

let panels: ReturnType<typeof usePanels>;
const Probe = () => { panels = usePanels(); return null; };
const renderRail = (withSpotlight = false) => render(
    <TooltipProvider>
        <SidebarProvider>
            <PanelsProvider>
                <Probe />
                <AppSidebar />
                {withSpotlight && <BindingSpotlight />}
            </PanelsProvider>
        </SidebarProvider>
    </TooltipProvider>,
);
const openEditor = (panel: string, item: number) => act(() => {
    panels.setPanelToGoBack(null);
    panels.setActivePanel(panel);
    panels.setAlternativeHeader(true);
    panels.setItemToEdit(item);
    panels.setBindingTypeToEdit(panel);
});
const railEl = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-slot="sidebar-container"]')!;
const railButtons = (container: HTMLElement) =>
    within(railEl(container)).getAllByRole('button').map(b => b.getAttribute('aria-label'));
const navToggle = () => screen.getByRole('button', { name: /navigation/ });
const railState = (container: HTMLElement) => container.querySelector('[data-slot="sidebar"]')!.getAttribute('data-state');
const setRail = (expanded: boolean) => {
    if ((navToggle().getAttribute('aria-expanded') === 'true') !== expanded) fireEvent.click(navToggle());
    expect(navToggle()).toHaveAttribute('aria-expanded', String(expanded));
};
const TOGGLE = /^(Expand|Collapse) navigation$/;
const withoutToggle = (names: (string | null)[]) => names.filter(n => !TOGGLE.test(n ?? ''));

const PICKERS = ['Standard Keys', 'Pointing Devices', 'Special Keys', 'Layer Keys', 'Mouse Keys', 'Tap Dance Keys', 'Macro Keys'];

describe('railMode param', () => {
    it('accepts modal', () => {
        expect(railModeFrom('?railMode=modal')).toBe('modal');
        expect(railModeFrom('?comboEditor=panel&railMode=modal')).toBe('modal');
        expect(railModeFrom('')).toBe('lift');
    });
});

describe('?railMode=modal: the rail while a binding editor is open', () => {
    beforeEach(() => setSearch('?railMode=modal&comboEditor=panel'));

    it("shows only the editor's picker categories, an exit in the corner and the width toggle", () => {
        const { container } = renderRail();
        expect(railButtons(container)).toContain('Combos');
        openEditor('combos', 3);
        const names = railButtons(container);
        expect(names[names.length - 1]).toMatch(TOGGLE);
        expect(withoutToggle(names)).toEqual(['Done with Combo 3', ...PICKERS]);
        expect(railEl(container).querySelector('[data-binding-scrim]')).toBeNull();
        expect(railEl(container).querySelector('[inert]')).toBeNull();
    });

    it('leaves out the category a tap dance cannot hold', () => {
        const { container } = renderRail();
        openEditor('tapdances', 1);
        expect(withoutToggle(railButtons(container))).toEqual(['Done with Tap Dance 1', ...PICKERS.filter(p => p !== 'Tap Dance Keys')]);
    });

    it('switches the picker from a category and marks it as the active item', () => {
        renderRail();
        openEditor('combos', 0);
        expect(screen.getByRole('button', { name: 'Standard Keys' })).toHaveAttribute('aria-pressed', 'true');
        fireEvent.click(screen.getByRole('button', { name: 'Mouse Keys' }));
        expect(panels.pickerMode).toBe('mouse');
        expect(panels.itemToEdit).toBe(0);
        expect(screen.getByRole('button', { name: 'Mouse Keys' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'Standard Keys' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('closes the editor from the top-left exit and restores the normal rail', () => {
        const { container } = renderRail();
        const before = railButtons(container);
        openEditor('combos', 2);
        const exit = screen.getByRole('button', { name: 'Done with Combo 2' });
        expect(exit).toHaveAttribute('data-binding-editor-back');
        fireEvent.click(exit);
        expect(panels.itemToEdit).toBeNull();
        expect(railButtons(container)).toEqual(before);
        expect(screen.queryByRole('button', { name: 'Done with Combo 2' })).toBeNull();
    });

    it("keeps the person's width, and its toggle works while editing", () => {
        const { container } = renderRail();
        setRail(true);
        expect(railState(container)).toBe('expanded');
        openEditor('combos', 1);
        expect(railState(container)).toBe('expanded');
        const label = () => document.querySelector('[data-rail-exit-label]')!;
        expect(label()).toHaveTextContent('Done withCombo 1');
        expect(label()).not.toHaveClass('hidden');
        fireEvent.click(navToggle());
        expect(railState(container)).toBe('collapsed');
        expect(label()).toHaveClass('hidden');
        fireEvent.click(screen.getByRole('button', { name: 'Done with Combo 1' }));
        expect(railState(container)).toBe('collapsed');
    });

    it('points a blocked click at the top-left exit', () => {
        renderRail(true);
        openEditor('combos', 4);
        const pageScrim = [...document.querySelectorAll('[data-binding-scrim]')].find(el => !el.closest('[data-slot="sidebar-container"]'))!;
        fireEvent.click(pageScrim, { clientX: 600, clientY: 300 });
        const exit = screen.getByRole('button', { name: 'Done with Combo 4' });
        expect(exit).toHaveClass('binding-back-pulse');
        expect(document.querySelector('[data-binding-back-callout]')).toHaveAttribute('data-binding-back-callout', 'arrow');
        expect(panels.itemToEdit).toBe(4);
    });
});

describe('without the param the rail is unchanged', () => {
    it('keeps its navigation and scrim while editing', () => {
        const { container } = renderRail();
        openEditor('combos', 2);
        expect(railButtons(container)).toContain('Combos');
        expect(screen.queryByRole('button', { name: 'Done with Combo 2' })).toBeNull();
        expect(railEl(container).querySelector('[data-binding-scrim]')).not.toBeNull();
    });
});
