import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SidebarProvider } from '../../src/components/ui/sidebar';
import AppSidebar from '../../src/layout/Sidebar';
import { takeSettingsSectionRequest } from '../../src/layout/SecondarySidebar/Panels/settings/anchor';

const panels = vi.hoisted(() => ({
    activePanel: null as string | null, open: false,
    setActivePanel: vi.fn(), openDetails: vi.fn(), handleCloseDetails: vi.fn(),
}));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));
vi.mock('@/features/trainer/OverlayDialog', () => ({ OverlayDialog: () => null, overlayRequested: () => false }));
vi.mock('@/contexts/KeyboardContext', () => ({ useKeyboard: () => ({ keyboard: null }) }));
vi.mock('@/contexts/SettingsContext', () => ({ useSettings: () => ({ getSetting: () => undefined }) }));
const firmware = vi.hoisted(() => ({ dot: false }));
vi.mock('@/features/firmware/FirmwareUpdateProvider', () => ({ useFirmwareUpdates: () => ({ status: { dot: firmware.dot } }) }));
vi.mock('@/contexts/PanelsContext', () => ({ usePanels: () => ({
    ...panels, setItemToEdit: vi.fn(), panelToGoBack: null, alternativeHeader: false,
    setPanelToGoBack: vi.fn(), setAlternativeHeader: vi.fn(), setOpen: vi.fn(),
}) }));

const renderRail = () => render(<SidebarProvider><AppSidebar /></SidebarProvider>);

beforeEach(() => { vi.clearAllMocks(); panels.activePanel = null; panels.open = false; firmware.dot = false; takeSettingsSectionRequest(); });

describe('rail homes for what left Settings', () => {
    it('lists Typing Behavior after Overrides (Alt-Repeat off), and Hardware beside Layouts', () => {
        renderRail();
        const names = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'));
        expect(names.indexOf('Typing Behavior')).toBe(names.indexOf('Overrides') + 1);
        expect(names.indexOf('Hardware')).toBe(names.indexOf('Layouts') + 1);
    });

    it.each([['Typing Behavior', 'typing'], ['Hardware', 'clusters']])('opens %s as a panel', (name, panel) => {
        renderRail();
        fireEvent.click(screen.getByRole('button', { name }));
        expect(panels.setActivePanel).toHaveBeenCalledWith(panel);
        expect(panels.openDetails).toHaveBeenCalled();
    });

    it('opens Settings at About from the About item', () => {
        renderRail();
        fireEvent.click(screen.getByRole('button', { name: 'About' }));
        expect(panels.setActivePanel).toHaveBeenCalledWith('settings');
        expect(takeSettingsSectionRequest()).toBe('about');
    });

    it('scrolls an open Settings to About without closing it', () => {
        panels.activePanel = 'settings';
        panels.open = true;
        const heard: string[] = [];
        const listener = (e: Event) => heard.push((e as CustomEvent<string>).detail);
        window.addEventListener('keybard-settings-section', listener);
        renderRail();
        fireEvent.click(screen.getByRole('button', { name: 'About' }));
        expect(panels.handleCloseDetails).not.toHaveBeenCalled();
        expect(heard).toEqual(['about']);
        window.removeEventListener('keybard-settings-section', listener);
    });
});

describe('the firmware update dot', () => {
    it('marks Settings when an update is available and not yet seen', () => {
        firmware.dot = true;
        renderRail();
        expect(screen.getByRole('button', { name: 'Settings, firmware update available' })).toBeTruthy();
        expect(screen.getAllByTestId('rail-dot')).toHaveLength(1);
    });

    it('is quiet otherwise', () => {
        renderRail();
        expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy();
        expect(screen.queryByTestId('rail-dot')).toBeNull();
    });
});
