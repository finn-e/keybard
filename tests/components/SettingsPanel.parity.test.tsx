import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsPanel from '../../src/layout/SecondarySidebar/Panels/SettingsPanel';
import { SETTINGS } from '../../src/contexts/SettingsContext';

const state = vi.hoisted(() => ({
    mode: 'sidebar', navigate: vi.fn(), navigateTo: vi.fn(), connected: true,
    stored: {} as Record<string, string | number | boolean>,
}));
vi.mock('@/contexts/KeyboardContext', () => ({ useKeyboard: () => ({ keyboard: null, isConnected: state.connected }) }));
vi.mock('@/contexts/LayoutSettingsContext', () => ({ useLayoutSettings: () => ({ layoutMode: state.mode }) }));
vi.mock('@/contexts/PanelsContext', () => ({ usePanels: () => ({ setActivePanel: state.navigate }) }));
vi.mock('@/App', () => ({ useNavigation: () => ({ navigateTo: state.navigateTo }) }));
vi.mock('@/hooks/useLayoutImport', () => ({ useLayoutImport: () => ({}) }));
vi.mock('@/contexts/SettingsContext', async (orig) => {
    const actual = await orig<typeof import('../../src/contexts/SettingsContext')>();
    return {
        ...actual,
        useSettings: () => ({
            getSetting: (name: string, fallback: unknown) => state.stored[name] ?? fallback,
            updateSetting: (name: string, value: string | number | boolean) => { state.stored[name] = value; },
            getSettingDefinition: (name: string) => actual.SETTINGS.find((s) => s.name === name),
        }),
    };
});
vi.mock('../../src/layout/SecondarySidebar/Panels/BoardIdentitySection', () => ({ default: () => <p>Board identity</p> }));
vi.mock('../../src/layout/SecondarySidebar/Panels/BackupsSection', () => ({ default: () => <p>Backups</p> }));
vi.mock('../../src/layout/SecondarySidebar/Panels/settings/FirmwareRow', () => ({ default: () => <p>Firmware status</p> }));
vi.mock('../../src/components/ExportDialog', () => ({ default: ({ open }: { open: boolean }) => (open ? <p>Export dialog</p> : null) }));

beforeEach(() => { vi.clearAllMocks(); state.stored = {}; state.connected = true; state.mode = 'sidebar'; });

describe('Settings page', () => {
    it('is one page in three groups, with sections in order', () => {
        render(<SettingsPanel />);
        const groups = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
        expect(groups).toEqual(['This keyboard', 'This browser', 'Keybard']);
        const sections = screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent);
        expect(sections).toEqual(['Firmware', 'Board', 'Backups and files', 'Appearance', 'Editing', 'About', 'Developer']);
        const keyboard = screen.getByRole('region', { name: 'This keyboard' });
        expect(within(keyboard).getByText('Firmware status')).toBeVisible();
        expect(within(keyboard).getByText('Board identity')).toBeVisible();
        expect(within(keyboard).getByText('Backups')).toBeVisible();
    });

    it('holds only app preferences and board management, never board configuration', () => {
        render(<SettingsPanel />);
        fireEvent.click(screen.getByRole('button', { name: 'Developer' }));
        const text = document.body.textContent ?? '';
        for (const banned of ['Typing Behavior', 'Tap-Hold', 'QMK Settings', 'Clusters', 'Fragments', 'Pointing', 'DPI',
            'Layer color', 'Brightness', 'Live Updating', 'Overlay', 'Combo timeout', 'Leader', 'Mouse key', 'Print Layers']) {
            expect(text).not.toContain(banned);
        }
        for (const def of SETTINGS.filter((s) => s.scope === 'hardware')) {
            expect(screen.queryByText(def.label)).toBeNull();
        }
    });

    it('shows each Appearance and Editing preference under its page label', () => {
        render(<SettingsPanel />);
        const appearance = screen.getByRole('region', { name: 'Appearance' });
        expect(within(appearance).getByRole('combobox', { name: 'Theme' })).toBeVisible();
        expect(within(appearance).getByRole('combobox', { name: 'Key size' })).toHaveValue('auto');
        expect(within(appearance).getByRole('combobox', { name: 'Panel position' })).toHaveValue('auto');
        const editing = screen.getByRole('region', { name: 'Editing' });
        expect(within(editing).getByRole('group', { name: 'Typing binds a key' })).toBeVisible();
        expect(within(editing).getByRole('combobox', { name: 'Advance after assigning' })).toBeVisible();
        expect(within(editing).getByRole('combobox', { name: 'Key legends' })).toBeVisible();
    });

    it('has no Large option, no gloss or sparkle slider, and combo indicators as an on/off switch', () => {
        render(<SettingsPanel />);
        expect(screen.queryByRole('option', { name: 'Large' })).toBeNull();
        expect(screen.queryAllByRole('slider')).toHaveLength(0);
        expect(screen.queryByText(/gloss|sparkle/i)).toBeNull();
        expect(screen.queryByText(/Binding editor placement/i)).toBeNull();
        const editing = screen.getByRole('region', { name: 'Editing' });
        const combo = within(editing).getByRole('group', { name: 'Combo indicators' });
        expect(within(combo).getByRole('button', { name: 'ON' })).toHaveAttribute('aria-pressed', 'true');
        fireEvent.click(within(combo).getByRole('button', { name: 'OFF' }));
        expect(state.stored['combo-indicators']).toBe(false);
        expect(within(editing).getByRole('group', { name: 'Colorblind-friendly combo colors' })).toBeVisible();
    });

    it('stores a changed preference', () => {
        render(<SettingsPanel />);
        fireEvent.change(screen.getByRole('combobox', { name: 'Key size' }), { target: { value: 'small' } });
        expect(state.stored['key-size']).toBe('small');
    });

    it('opens the one Export dialog from Backups and files', () => {
        render(<SettingsPanel />);
        expect(screen.queryByText('Export dialog')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Export layout' }));
        expect(screen.getByText('Export dialog')).toBeVisible();
        expect(screen.queryByRole('button', { name: /Print/ })).toBeNull();
    });

    it('keeps Developer collapsed until opened, then remembers it in this browser', () => {
        const view = render(<SettingsPanel />);
        const toggle = screen.getByRole('button', { name: 'Developer' });
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByRole('button', { name: 'Scan Lab' })).toBeNull();
        fireEvent.click(toggle);
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        expect(state.stored['settings-developer-opened']).toBe(true);
        fireEvent.click(screen.getByRole('button', { name: 'Scan Lab' }));
        expect(state.navigate).toHaveBeenCalledWith('scanlab');
        fireEvent.click(screen.getByRole('button', { name: 'Key proof sheet' }));
        expect(state.navigateTo).toHaveBeenCalledWith('proof-sheet');
        view.unmount();
        render(<SettingsPanel />);
        expect(screen.getByRole('button', { name: 'Developer' })).toHaveAttribute('aria-expanded', 'true');
    });

    it.each(['sidebar', 'bottombar'])('renders the same page in %s mode', (mode) => {
        state.mode = mode;
        render(<SettingsPanel />);
        expect(screen.getAllByRole('heading', { level: 4 })).toHaveLength(7);
        expect(screen.getByRole('navigation', { name: 'Settings sections' })).toBeVisible();
    });

    it('jumps to a section from its anchor chip', () => {
        const scroll = vi.fn();
        Element.prototype.scrollIntoView = scroll;
        render(<SettingsPanel />);
        const nav = screen.getByRole('navigation', { name: 'Settings sections' });
        expect(within(nav).getAllByRole('button').map((b) => b.textContent)).toEqual(['Firmware', 'Board', 'Backups', 'Appearance', 'Editing', 'About']);
        fireEvent.click(within(nav).getByRole('button', { name: 'About' }));
        expect(scroll).toHaveBeenCalledTimes(1);
        expect(scroll.mock.contexts[0]).toBe(document.getElementById('settings-section-about'));
    });

    it('asks for a connection where the board is needed', () => {
        state.connected = false;
        render(<SettingsPanel />);
        expect(screen.getByText('Connect a keyboard to see its name and serial.')).toBeVisible();
        expect(screen.queryByText('Board identity')).toBeNull();
    });
});
