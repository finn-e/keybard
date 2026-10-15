import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { SidebarProvider } from '../../src/components/ui/sidebar';
import { TooltipProvider } from '../../src/components/ui/tooltip';
import { PanelsProvider, usePanels } from '../../src/contexts/PanelsContext';
import EditorSidePanel from '../../src/layout/SecondarySidebar/components/EditorSidePanel';
import AppSidebar from '../../src/layout/Sidebar';
import { railModeFrom, SPOTLIGHT_NUDGE_EVENT } from '../../src/lib/bindingSpotlight';

vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));
vi.mock('@/contexts/KeyboardContext', () => ({ useKeyboard: () => ({ keyboard: null }) }));
vi.mock('@/contexts/SettingsContext', () => ({ useSettings: () => ({ getSetting: () => false }) }));
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
const renderRail = () => render(
    <TooltipProvider>
        <SidebarProvider>
            <PanelsProvider>
                <Probe />
                <AppSidebar />
            </PanelsProvider>
        </SidebarProvider>
    </TooltipProvider>,
);
const openEditor = (panel: string, item: number) => act(() => {
    panels.setActivePanel(panel);
    panels.setAlternativeHeader(true);
    panels.setItemToEdit(item);
    panels.setBindingTypeToEdit(panel);
});
const railState = (container: HTMLElement) => container.querySelector('[data-slot="sidebar"]')!.getAttribute('data-state');
const rail = (name: string) => screen.getByRole('button', { name });
const navToggle = () => screen.getByRole('button', { name: /navigation/ });
/** Sets the person's own rail width with the logo button, as they would. */
const setRail = (expanded: boolean) => {
    if ((navToggle().getAttribute('aria-expanded') === 'true') !== expanded) fireEvent.click(navToggle());
    expect(navToggle()).toHaveAttribute('aria-expanded', String(expanded));
};
const expandRail = () => setRail(true);

describe('railMode param', () => {
    it('is lift unless the URL asks for collapse', () => {
        expect(railModeFrom('')).toBe('lift');
        expect(railModeFrom('?railMode=collapse')).toBe('collapse');
        expect(railModeFrom('?railMode=bogus')).toBe('lift');
        expect(railModeFrom('?comboEditor=panel&railMode=collapse')).toBe('collapse');
    });
});

describe('?railMode=collapse: the rail while a binding editor is open', () => {
    beforeEach(() => setSearch('?railMode=collapse&comboEditor=panel'));

    it('collapses to its icons, under the scrim and inert, and comes back on exit', () => {
        const { container } = renderRail();
        expandRail();
        expect(railState(container)).toBe('expanded');
        expect(document.documentElement.getAttribute('data-rail-mode')).toBe('collapse');
        openEditor('combos', 2);
        expect(railState(container)).toBe('collapsed');
        expect(container.querySelector('[data-rail-collapsed]')).not.toBeNull();
        expect(container.querySelector('[data-binding-scrim]')).not.toBeNull();
        // Every item is covered, the picker categories too.
        for (const name of ['Standard Keys', 'Pointing Devices', 'Mouse Keys', 'Combos', 'Settings']) {
            expect(rail(name).closest('li')).toHaveAttribute('data-spotlight', 'cover');
            expect(rail(name).closest('li')).toHaveAttribute('inert');
        }
        expect(container.querySelector('[data-spotlight-rail]')).toBeNull();
        // The person's own width is not saved over.
        expect(document.cookie).toContain('primary-nav:state=true');
        act(() => panels.handleCloseEditor());
        expect(railState(container)).toBe('expanded');
        expect(container.querySelector('[data-rail-collapsed]')).toBeNull();
        expect(rail('Combos').closest('li')).not.toHaveAttribute('inert');
    });

    it('stays at icon width on exit when that is where it was', () => {
        const { container } = renderRail();
        setRail(false);
        expect(railState(container)).toBe('collapsed');
        openEditor('combos', 0);
        expect(railState(container)).toBe('collapsed');
        act(() => panels.handleCloseEditor());
        expect(railState(container)).toBe('collapsed');
        expect(document.cookie).toContain('primary-nav:state=false');
    });

    it('never switches the picker from the rail; a click there is a rail nudge', () => {
        renderRail();
        openEditor('combos', 1);
        const nudges: unknown[] = [];
        const listen = (e: Event) => nudges.push((e as CustomEvent).detail);
        window.addEventListener(SPOTLIGHT_NUDGE_EVENT, listen);
        // The rail's scrim takes the click (the items under it are inert).
        fireEvent.click(document.querySelector('[data-slot="sidebar-container"] [data-binding-scrim]')!, { clientX: 20, clientY: 200 });
        // Even a direct call on a covered item does not switch.
        fireEvent.click(rail('Mouse Keys'));
        window.removeEventListener(SPOTLIGHT_NUDGE_EVENT, listen);
        expect(panels.pickerMode).toBe('keyboard');
        expect(panels.itemToEdit).toBe(1);
        expect(nudges.length).toBe(2);
        for (const d of nudges) expect(d).toMatchObject({ from: 'rail' });
    });
});

describe('without the param the rail is unchanged', () => {
    it('keeps its width and lifts the picker categories', () => {
        const { container } = renderRail();
        expandRail();
        openEditor('combos', 2);
        expect(railState(container)).toBe('expanded');
        expect(document.documentElement.hasAttribute('data-rail-mode')).toBe(false);
        expect(rail('Mouse Keys').closest('li')).toHaveAttribute('data-spotlight', 'lift');
        fireEvent.click(rail('Mouse Keys'));
        expect(panels.pickerMode).toBe('mouse');
    });
});

describe("the side panel's category strip", () => {
    it('is marked as the strip and switches the picker', () => {
        const onTabChange = vi.fn();
        render(<TooltipProvider><EditorSidePanel activeTab="keyboard" onTabChange={onTabChange} /></TooltipProvider>);
        const strip = document.querySelector('[data-picker-strip]')!;
        expect(strip).not.toBeNull();
        expect(strip.closest('[inert]')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Layer Keys' }));
        expect(onTabChange).toHaveBeenCalledWith('layers');
    });
});
