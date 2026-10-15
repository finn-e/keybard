import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { SidebarProvider } from '../../src/components/ui/sidebar';
import { TooltipProvider } from '../../src/components/ui/tooltip';
import { PanelsProvider, usePanels } from '../../src/contexts/PanelsContext';
import AppSidebar from '../../src/layout/Sidebar';

vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));
vi.mock('@/contexts/KeyboardContext', () => ({ useKeyboard: () => ({ keyboard: null }) }));
vi.mock('@/features/trainer/OverlayDialog', () => ({ OverlayDialog: () => null, overlayRequested: () => false }));

beforeAll(() => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(cleanup);

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

const rail = (name: string) => screen.getByRole('button', { name });

describe('the rail while a binding editor is open', () => {
    it('switches the picker on a usable category and keeps the editor open', () => {
        renderRail();
        openEditor('combos', 3);
        for (const [name, mode] of [['Pointing Devices', 'pointing'], ['Special Keys', 'special'], ['Layer Keys', 'layers'], ['Mouse Keys', 'mouse'], ['Tap Dance Keys', 'tapdances'], ['Macro Keys', 'macros'], ['Standard Keys', 'keyboard']]) {
            fireEvent.click(rail(name));
            expect(panels.pickerMode).toBe(mode);
            expect(panels.itemToEdit).toBe(3);
            expect(panels.activePanel).toBe('combos');
        }
        // The rail marks the category in use, not the editor's own panel.
        fireEvent.click(rail('Mouse Keys'));
        expect(rail('Mouse Keys')).toHaveAttribute('aria-pressed', 'true');
        expect(rail('Combos')).toHaveAttribute('aria-pressed', 'false');
    });

    it('does not navigate from covered rail items', () => {
        renderRail();
        openEditor('combos', 1);
        for (const name of ['Combos', 'Overrides', 'Alt-Repeat', 'Leaders', 'Layouts', 'Overlay', 'Quick Start', 'About', 'Settings']) {
            fireEvent.click(rail(name));
            expect(panels.itemToEdit).toBe(1);
            expect(panels.activePanel).toBe('combos');
            expect(panels.pickerMode).toBe('keyboard');
        }
    });

    it('does not switch to a category the editor cannot hold', () => {
        renderRail();
        openEditor('tapdances', 2);
        fireEvent.click(rail('Tap Dance Keys'));
        expect(panels.pickerMode).toBe('keyboard');
        expect(panels.itemToEdit).toBe(2);
        act(() => panels.setItemToEdit(null));
        openEditor('macros', 0);
        fireEvent.click(rail('Macro Keys'));
        expect(panels.pickerMode).toBe('keyboard');
        expect(panels.activePanel).toBe('macros');
    });

    it('navigates as before when no editor is open', () => {
        renderRail();
        fireEvent.click(rail('Overrides'));
        expect(panels.activePanel).toBe('overrides');
        fireEvent.click(rail('Pointing Devices'));
        expect(panels.activePanel).toBe('pointing');
        expect(panels.pickerMode).toBe('keyboard');
    });

    it('lifts the usable categories above its scrim and makes the rest inert', () => {
        const { container } = renderRail();
        expect(container.querySelector('[data-logo-mark="brand"]')).not.toBeNull();
        openEditor('macros', 0);
        const item = (name: string) => rail(name).closest('li')!;
        for (const name of ['Standard Keys', 'Pointing Devices', 'Special Keys', 'Layer Keys', 'Mouse Keys', 'Tap Dance Keys']) {
            expect(item(name)).toHaveAttribute('data-spotlight', 'lift');
            expect(item(name)).not.toHaveAttribute('inert');
        }
        for (const name of ['Macro Keys', 'Combos', 'Overrides', 'Layouts', 'Settings', 'About']) {
            expect(item(name)).toHaveAttribute('data-spotlight', 'cover');
            expect(item(name)).toHaveAttribute('inert');
        }
        expect(container.querySelector('[data-binding-scrim]')).not.toBeNull();
        // The logo becomes the viewfinder mark, a focus cue rather than a control.
        expect(container.querySelector('[data-logo-mark="viewfinder"]')).not.toBeNull();
        expect(container.querySelector('[data-logo-mark="brand"]')).toBeNull();
        expect(screen.getByRole('button', { name: /navigation/ }).closest('li')).toHaveAttribute('inert');
        act(() => panels.handleCloseEditor());
        expect(container.querySelector('[data-logo-mark="brand"]')).not.toBeNull();
        expect(container.querySelector('[data-binding-scrim]')).toBeNull();
        expect(item('Combos')).not.toHaveAttribute('inert');
    });
});
