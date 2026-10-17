import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SidebarProvider } from '../../src/components/ui/sidebar';
import AppSidebar from '../../src/layout/Sidebar';
import { settingsSectionForPanel, takeSettingsSectionRequest } from '../../src/layout/SecondarySidebar/Panels/settings/anchor';
import PointingDeepLink from '../../src/layout/PointingDeepLink';
import { _resetPointingDemoForTests, pointingDemoFromSearch } from '../../src/features/pointing-demo';

const panels = vi.hoisted(() => ({
    activePanel: null as string | null, open: false,
    setActivePanel: vi.fn(), openDetails: vi.fn(), handleCloseDetails: vi.fn(),
}));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));
vi.mock('@/features/trainer/OverlayDialog', () => ({ OverlayDialog: () => null, overlayRequested: () => false }));
const deepLink = vi.hoisted(() => ({ keyboard: null as unknown }));
vi.mock('@/contexts/KeyboardContext', () => ({ useKeyboard: () => ({ keyboard: deepLink.keyboard }) }));
vi.mock('@/contexts/SettingsContext', () => ({ useSettings: () => ({ getSetting: () => undefined }) }));
const firmware = vi.hoisted(() => ({ dot: false }));
vi.mock('@/features/firmware/FirmwareUpdateProvider', () => ({ useFirmwareUpdates: () => ({ status: { dot: firmware.dot } }) }));
vi.mock('@/contexts/PanelsContext', () => ({ usePanels: () => ({
    ...panels, setItemToEdit: vi.fn(), panelToGoBack: null, alternativeHeader: false,
    setPanelToGoBack: vi.fn(), setAlternativeHeader: vi.fn(), setOpen: vi.fn(),
}) }));

const renderRail = () => render(<SidebarProvider><AppSidebar /></SidebarProvider>);

beforeEach(() => { vi.clearAllMocks(); panels.activePanel = null; panels.open = false; firmware.dot = false; takeSettingsSectionRequest(); });

describe('the rail holds what is used while editing', () => {
    it('has no Typing Behavior or Hardware item: both live in Settings', () => {
        renderRail();
        const names = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'));
        for (const gone of ['Typing Behavior', 'Typing behavior', 'Hardware', 'Clusters']) expect(names).not.toContain(gone);
        expect(names.indexOf('Overlay')).toBe(names.indexOf('Layouts') + 1);
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

describe('old links to the panels that moved into Settings', () => {
    it.each([['typing', 'typing'], ['clusters', 'hardware'], ['fragments', 'hardware']])('?panel=%s lands in Settings at %s', (panel, section) => {
        expect(settingsSectionForPanel(panel)).toBe(section);
        expect(pointingDemoFromSearch(`?demo=combos&panel=${panel}`)!.panel).toBe(panel);
    });

    it('opens Settings at that section once a layout is loaded', () => {
        deepLink.keyboard = { name: 'demo' };
        _resetPointingDemoForTests();
        window.history.replaceState(null, '', '/keybard/?demo=combos&panel=typing');
        render(<PointingDeepLink />);
        expect(panels.setActivePanel).toHaveBeenCalledWith('settings');
        expect(panels.openDetails).toHaveBeenCalled();
        expect(takeSettingsSectionRequest()).toBe('typing');
        window.history.replaceState(null, '', '/');
        _resetPointingDemoForTests();
        deepLink.keyboard = null;
    });

    it('ignores names that are not panels', () => {
        expect(settingsSectionForPanel('toString')).toBeUndefined();
        expect(pointingDemoFromSearch('?panel=toString')).toBeNull();
    });
});
