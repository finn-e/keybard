import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SettingsPanel from '../../src/layout/SecondarySidebar/Panels/SettingsPanel';

const mocks = vi.hoisted(() => ({ connected: true, instant: true, pending: {} as Record<string, unknown>, loadFromFile: vi.fn(), queue: vi.fn(), sync: vi.fn(), commit: vi.fn(), load: vi.fn(), setKeyboard: vi.fn(), keyboard: { rows: 1, cols: 1, layers: 1, keymap: [[4]], name: 'Test keyboard', macros: [], macro_count: 0, settings: {} } }));
vi.mock('@/contexts/KeyboardContext', () => ({ useKeyboard: () => ({ keyboard: mocks.keyboard, setKeyboard: mocks.setKeyboard, isConnected: mocks.connected, loadFromFile: mocks.loadFromFile, setIsImporting: vi.fn() }) }));
vi.mock('@/contexts/ChangesContext', () => ({ useChanges: () => ({ queue: mocks.queue, todo: mocks.pending, isInstant: mocks.instant, isSaving: false, commit: mocks.commit }) }));
vi.mock('@/contexts/SettingsContext', () => ({ useSettings: () => ({ getSetting: vi.fn(), updateSetting: vi.fn(), settingsDefinitions: [], settingsCategories: [] }) }));
vi.mock('@/contexts/LayoutSettingsContext', () => ({ useLayoutSettings: () => ({ layoutMode: 'sidebar' }) }));
vi.mock('@/contexts/PanelsContext', () => ({ usePanels: () => ({ setActivePanel: vi.fn() }) }));
vi.mock('@/App', () => ({ useNavigation: () => ({ navigateTo: vi.fn() }) }));
vi.mock('@/services/file.service', () => ({ fileService: { uploadFile: mocks.load, downloadSvil: vi.fn() } }));
vi.mock('@/services/import.service', () => ({ importService: { syncWithKeyboard: mocks.sync } }));
vi.mock('@/services/keyboard.service', () => ({ keyboardService: {} }));
vi.mock('../../src/layout/SecondarySidebar/Panels/BoardIdentitySection', () => ({ default: () => null }));
vi.mock('../../src/layout/SecondarySidebar/Panels/FragmentsPanel', () => ({ default: () => null }));
vi.mock('../../src/layout/SecondarySidebar/Panels/DynamicMenuPanel', () => ({ default: () => null }));

beforeEach(() => { vi.clearAllMocks(); mocks.connected = true; mocks.instant = true; mocks.pending = {}; mocks.loadFromFile.mockResolvedValue(true); mocks.load.mockResolvedValue({ ...mocks.keyboard, keymap: [[5]] }); mocks.commit.mockResolvedValue(true); });
const chooseFile = (container: HTMLElement) => fireEvent.change(container.querySelector('input[type=file]')!, { target: { files: [new File(['{}'], 'layout.svil')] } });
describe('import review', () => {
    it('does not write or replace the draft on file selection or cancellation', async () => {
        const { container } = render(<SettingsPanel />);
        chooseFile(container);
        await screen.findByRole('dialog');
        expect(mocks.sync).not.toHaveBeenCalled();
        expect(mocks.queue).not.toHaveBeenCalled();
        expect(mocks.setKeyboard).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(mocks.sync).not.toHaveBeenCalled();
    });
    it('writes only after explicit approval and reports failed writes', async () => {
        mocks.commit.mockResolvedValue(false);
        const { container } = render(<SettingsPanel />);
        chooseFile(container);
        fireEvent.click(await screen.findByRole('button', { name: 'Apply import' }));
        await waitFor(() => expect(mocks.sync).toHaveBeenCalledTimes(1));
        expect(await screen.findByRole('alert')).toHaveTextContent('Some imported changes could not be saved');
        expect(screen.queryByText('Import saved to keyboard.')).toBeNull();
    });
    it('blocks incompatible files without invoking writes', async () => {
        mocks.load.mockResolvedValue({ ...mocks.keyboard, cols: 2, keymap: [[5, 6]] });
        const { container } = render(<SettingsPanel />);
        chooseFile(container);
        expect(await screen.findByRole('button', { name: 'Apply import' })).toBeDisabled();
        expect(mocks.sync).not.toHaveBeenCalled();
    });
    it('shows no status text after a successful instant import', async () => {
        const { container } = render(<SettingsPanel />);
        chooseFile(container);
        fireEvent.click(await screen.findByRole('button', { name: 'Apply import' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(mocks.commit).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('status')).toBeNull();
    });
    it('stages the entire import without committing in Manual mode', async () => {
        mocks.instant = false;
        const { container } = render(<SettingsPanel />);
        chooseFile(container);
        fireEvent.click(await screen.findByRole('button', { name: 'Stage import' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(mocks.sync).toHaveBeenCalledTimes(1);
        // The Apply button's pending count shows the staged state; no status text.
        expect(screen.queryByRole('status')).toBeNull();
        expect(mocks.commit).not.toHaveBeenCalled();
    });
    it('uses the provider offline-loading path and does not claim success if cancelled', async () => {
        mocks.connected = false;
        mocks.loadFromFile.mockResolvedValue(false);
        const { container } = render(<SettingsPanel />);
        chooseFile(container);
        fireEvent.click(await screen.findByRole('button', { name: 'Open layout' }));
        await waitFor(() => expect(mocks.loadFromFile).toHaveBeenCalledTimes(1));
        expect(mocks.setKeyboard).not.toHaveBeenCalled();
        expect(mocks.sync).not.toHaveBeenCalled();
        expect(screen.queryByRole('status')).toBeNull();
    });
    it('requires pending edits to be resolved before reading another file', async () => {
        mocks.pending = { key: {} };
        const { container } = render(<SettingsPanel />);
        chooseFile(container);
        expect(await screen.findByRole('alert')).toHaveTextContent('Apply or discard');
        expect(mocks.load).not.toHaveBeenCalled();
    });

});
