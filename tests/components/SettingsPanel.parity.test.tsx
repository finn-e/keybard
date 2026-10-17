import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsPanel from '../../src/layout/SecondarySidebar/Panels/SettingsPanel';
import { SETTINGS } from '../../src/contexts/SettingsContext';
import { _setSettingsLayoutForTests, settingsLayoutFromSearch } from '../../src/layout/SecondarySidebar/Panels/settings/layout';
import { requestSettingsSection } from '../../src/layout/SecondarySidebar/Panels/settings/anchor';

const state = vi.hoisted(() => ({
    mode: 'sidebar', navigate: vi.fn(), navigateTo: vi.fn(), connected: true,
    stored: {} as Record<string, string | number | boolean>, storageFails: false,
}));
vi.mock('../../src/layout/SecondarySidebar/Panels/ClustersPanel', () => ({ default: () => <p>Hardware rows</p> }));
vi.mock('../../src/layout/SecondarySidebar/Panels/TypingBehaviorPanel', () => ({ default: () => <p>Typing behavior rows</p> }));
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
            getSetting: (name: string, fallback: unknown) => {
                if (state.storageFails && name === 'settings-hardware-open') throw new Error('storage unavailable');
                return state.stored[name] ?? fallback ?? false;
            },
            updateSetting: (name: string, value: string | number | boolean) => {
                if (state.storageFails && name === 'settings-hardware-open') throw new Error('storage unavailable');
                state.stored[name] = value;
            },
            getSettingDefinition: (name: string) => actual.SETTINGS.find((s) => s.name === name),
        }),
    };
});
vi.mock('../../src/layout/SecondarySidebar/Panels/BoardIdentitySection', () => ({ default: () => <p>Board identity</p> }));
vi.mock('../../src/layout/SecondarySidebar/Panels/BackupsSection', () => ({ default: () => <p>Backups</p> }));
vi.mock('../../src/layout/SecondarySidebar/Panels/settings/FirmwareRow', () => ({ default: () => <p>Firmware status</p> }));
vi.mock('../../src/components/ExportDialog', () => ({ default: ({ open }: { open: boolean }) => (open ? <p>Export dialog</p> : null) }));

beforeEach(() => { vi.clearAllMocks(); state.stored = {}; state.connected = true; state.mode = 'sidebar'; state.storageFails = false; _setSettingsLayoutForTests(undefined); });
afterEach(() => _setSettingsLayoutForTests(undefined));

describe('Settings page', () => {
    it('is one page in two groups by default (option A), with sections in order', () => {
        render(<SettingsPanel />);
        const groups = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
        expect(groups).toEqual(['This keyboard', 'Keybard']);
        const sections = screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent);
        expect(sections).toEqual(['Hardware', 'Firmware and board', 'Backups and files', 'Typing behavior', 'Appearance and editing', 'About', 'Developer']);
        const keyboard = screen.getByRole('region', { name: 'This keyboard' });
        expect(within(keyboard).getByText('Hardware rows')).toBeVisible();
        expect(within(keyboard).getByText('Firmware status')).toBeVisible();
        expect(within(keyboard).getByText('Board identity')).toBeVisible();
        expect(within(keyboard).getByText('Backups')).toBeVisible();
    });

    it('holds Hardware open and Typing behavior closed until opened, and no layout configuration', () => {
        render(<SettingsPanel />);
        expect(screen.getByText('Hardware rows')).toBeVisible();
        const typing = screen.getByRole('button', { name: 'Typing behavior' });
        expect(typing).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByText('Typing behavior rows')).toBeNull();
        fireEvent.click(typing);
        expect(screen.getByText('Typing behavior rows')).toBeVisible();
        fireEvent.click(screen.getByRole('button', { name: 'Developer' }));
        const text = document.body.textContent ?? '';
        for (const banned of ['QMK Settings', 'DPI', 'Layer color', 'Brightness', 'Live Updating', 'Overlay', 'Combo timeout',
            'Leader', 'Mouse key', 'Print Layers']) {
            expect(text).not.toContain(banned);
        }
        for (const def of SETTINGS.filter((s) => s.scope === 'hardware')) {
            expect(screen.queryByText(def.label)).toBeNull();
        }
    });

    it('shows each Appearance and Editing preference under its page label', () => {
        render(<SettingsPanel />);
        const appearance = screen.getByRole('region', { name: 'Appearance and editing' });
        expect(within(appearance).getByRole('combobox', { name: 'Theme' })).toBeVisible();
        expect(within(appearance).getByRole('combobox', { name: 'Key size' })).toHaveValue('auto');
        expect(within(appearance).getByRole('combobox', { name: 'Panel position' })).toHaveValue('auto');
        const editing = appearance;
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
        const editing = screen.getByRole('region', { name: 'Appearance and editing' });
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
        expect(within(nav).getAllByRole('button').map((b) => b.textContent)).toEqual(['Hardware', 'Firmware', 'Backups', 'Appearance']);
        fireEvent.click(within(nav).getByRole('button', { name: 'Backups' }));
        expect(scroll).toHaveBeenCalledTimes(1);
        expect(scroll.mock.contexts[0]).toBe(document.getElementById('settings-section-backups'));
    });

    it('asks for a connection where the board is needed', () => {
        state.connected = false;
        render(<SettingsPanel />);
        expect(screen.getByText('Connect a keyboard to see its name and serial.')).toBeVisible();
        expect(screen.queryByText('Board identity')).toBeNull();
    });
});

const hardwareToggle = () => within(screen.getByRole('heading', { level: 4, name: 'Hardware' })).getByRole('button');

describe('the organizations under review (?settingsLayout=a|b|c)', () => {
    const h3 = () => screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    const h4 = () => screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent);

    it('reads the option from the page address, defaulting to A', () => {
        expect(settingsLayoutFromSearch('?demo=combos&panel=settings&settingsLayout=b')).toBe('b');
        expect(settingsLayoutFromSearch('?settingsLayout=C')).toBe('c');
        expect(settingsLayoutFromSearch('?settingsLayout=z')).toBe('a');
        expect(settingsLayoutFromSearch('')).toBe('a');
    });

    it('B: set up, everyday, advanced, with About at the end', () => {
        _setSettingsLayoutForTests('b');
        render(<SettingsPanel />);
        expect(h3()).toEqual(['Set up', 'Everyday', 'Advanced', 'Keybard']);
        expect(h4()).toEqual(['Hardware', 'Firmware and board', 'Appearance', 'Editing', 'Backups and files', 'Typing behavior', 'Developer', 'About']);
        const nav = screen.getByRole('navigation', { name: 'Settings sections' });
        expect(within(nav).getAllByRole('button').map((b) => b.textContent)).toEqual(['Set up', 'Everyday', 'Advanced']);
        expect(screen.getByText('Hardware rows')).toBeVisible();
        expect(screen.getByRole('button', { name: 'Typing behavior' })).toHaveAttribute('aria-expanded', 'false');
    });

    it('C: five collapsible cards, Hardware open, no chips', () => {
        _setSettingsLayoutForTests('c');
        render(<SettingsPanel />);
        expect(h4()).toEqual(['Hardware', 'Firmware and backups', 'Appearance and editing', 'Typing behavior', 'About']);
        expect(screen.queryByRole('navigation', { name: 'Settings sections' })).toBeNull();
        expect(hardwareToggle()).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByText('Hardware rows')).toBeVisible();
        for (const name of ['Firmware and backups', 'Appearance and editing', 'Typing behavior', 'About']) {
            expect(screen.getByRole('button', { name }), name).toHaveAttribute('aria-expanded', 'false');
        }
        fireEvent.click(screen.getByRole('button', { name: 'About' }));
        expect(screen.getByRole('button', { name: 'Scan Lab' })).toBeVisible();
    });

    it.each(['a', 'b', 'c'] as const)('%s: an old Typing Behavior link opens Settings at Typing behavior, opened', (id) => {
        _setSettingsLayoutForTests(id);
        Element.prototype.scrollIntoView = vi.fn();
        const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(0); return 0; });
        requestSettingsSection('typing');
        render(<SettingsPanel />);
        expect(screen.getByRole('button', { name: 'Typing behavior' })).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByText('Typing behavior rows')).toBeVisible();
        raf.mockRestore();
    });
});

describe('Hardware remembers whether it was left open or collapsed', () => {
    const KEY = 'settings-hardware-open';
    const raf = () => vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(0); return 0; });

    it.each(['a', 'b', 'c'] as const)('%s: open on a first visit, then as it was left', (id) => {
        _setSettingsLayoutForTests(id);
        const view = render(<SettingsPanel />);
        expect(hardwareToggle()).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByText('Hardware rows')).toBeVisible();
        fireEvent.click(hardwareToggle());
        expect(hardwareToggle()).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByText('Hardware rows')).toBeNull();
        expect(state.stored[KEY]).toBe('collapsed');
        view.unmount();
        const again = render(<SettingsPanel />);
        expect(hardwareToggle()).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(hardwareToggle());
        expect(state.stored[KEY]).toBe('open');
        again.unmount();
        render(<SettingsPanel />);
        expect(hardwareToggle()).toHaveAttribute('aria-expanded', 'true');
    });

    it('opens for an old ?panel=clusters link without changing what is remembered', () => {
        state.stored[KEY] = 'collapsed';
        Element.prototype.scrollIntoView = vi.fn();
        const spy = raf();
        requestSettingsSection('hardware');
        const view = render(<SettingsPanel />);
        expect(hardwareToggle()).toHaveAttribute('aria-expanded', 'true');
        expect(state.stored[KEY]).toBe('collapsed');
        spy.mockRestore();
        view.unmount();
        render(<SettingsPanel />);
        expect(hardwareToggle()).toHaveAttribute('aria-expanded', 'false');
    });

    it('opens for a search match without changing what is remembered', () => {
        state.stored[KEY] = 'collapsed';
        render(<SettingsPanel />);
        expect(screen.queryByText('Hardware rows')).toBeNull();
        fireEvent.change(screen.getByRole('textbox', { name: 'Search settings' }), { target: { value: 'trackball' } });
        expect(screen.getByText('Hardware rows')).toBeVisible();
        fireEvent.change(screen.getByRole('textbox', { name: 'Search settings' }), { target: { value: '' } });
        expect(screen.queryByText('Hardware rows')).toBeNull();
        expect(state.stored[KEY]).toBe('collapsed');
    });

    it('falls back to open when storage fails, and still toggles', () => {
        state.storageFails = true;
        render(<SettingsPanel />);
        expect(hardwareToggle()).toHaveAttribute('aria-expanded', 'true');
        fireEvent.click(hardwareToggle());
        expect(hardwareToggle()).toHaveAttribute('aria-expanded', 'false');
    });

    it('treats an unknown stored value, or the app default of false, as a first visit', () => {
        state.stored[KEY] = false;
        render(<SettingsPanel />);
        expect(hardwareToggle()).toHaveAttribute('aria-expanded', 'true');
    });
});
