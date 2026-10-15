import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StorageResetDialog, OPEN_BACKUPS_EVENT } from '../../src/components/StorageResetDialog';

const keyboardContext = vi.hoisted(() => ({ isConnected: true, keyboard: { kbid: 'abc', storage_reset: true } as Record<string, unknown>, setKeyboard: vi.fn() }));
vi.mock('@/contexts/KeyboardContext', () => ({ useKeyboard: () => keyboardContext }));
const svc = vi.hoisted(() => ({ clearStorageReset: vi.fn() }));
vi.mock('@/services/keyboard.service', () => ({ keyboardService: svc }));
const changes = vi.hoisted(() => ({ queue: vi.fn(), commit: vi.fn() }));
vi.mock('@/contexts/ChangesContext', () => ({ useChanges: () => changes }));
const backups = vi.hoisted(() => ({ snapshots: [] as Array<Record<string, unknown>>, board: { key: 'sval:1', name: 'Kip' } as { key: string; name: string } | null }));
vi.mock('@/contexts/BackupContext', () => ({ useBackups: () => backups, serializeForBackup: () => '{"current":true}' }));
const restore = vi.hoisted(() => ({ restoreLayoutToBoard: vi.fn() }));
vi.mock('@/features/firmware/restore', () => restore);
const backupService = vi.hoisted(() => ({ getSvil: vi.fn() }));
vi.mock('@/services/backup/backup.service', () => ({ getBackupService: () => backupService }));

describe('StorageResetDialog', () => {
    beforeEach(() => {
        svc.clearStorageReset.mockReset().mockResolvedValue(undefined);
        restore.restoreLayoutToBoard.mockReset().mockResolvedValue({ trimmed: [] });
        backupService.getSvil.mockReset().mockResolvedValue('{"backup":true}');
        keyboardContext.isConnected = true;
        keyboardContext.keyboard = { kbid: 'abc', storage_reset: true };
        backups.snapshots = [];
        backups.board = { key: 'sval:1', name: 'Kip' };
        sessionStorage.clear();
    });

    it('tells the user to reload their layout file when there is no backup, and clears the board notice on OK', async () => {
        render(<StorageResetDialog />);
        expect(screen.getByText("Your keyboard's settings were reset")).toBeTruthy();
        expect(screen.getByText(/Load your layout file/)).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'OK' }));
        await waitFor(() => expect(svc.clearStorageReset).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(screen.queryByText("Your keyboard's settings were reset")).toBeNull());
    });

    it('stays hidden when the board reports no reset or is disconnected', () => {
        keyboardContext.keyboard = { kbid: 'abc', storage_reset: false };
        const { rerender } = render(<StorageResetDialog />);
        expect(screen.queryByText("Your keyboard's settings were reset")).toBeNull();
        keyboardContext.keyboard = { kbid: 'abc', storage_reset: true };
        keyboardContext.isConnected = false;
        rerender(<StorageResetDialog />);
        expect(screen.queryByText("Your keyboard's settings were reset")).toBeNull();
        expect(svc.clearStorageReset).not.toHaveBeenCalled();
    });

    it('warns that changes are not being saved, and dismisses without telling the board', async () => {
        keyboardContext.keyboard = { kbid: 'abc', storage_write_failed: true };
        render(<StorageResetDialog />);
        expect(screen.getByText("Your keyboard can't save changes")).toBeTruthy();
        expect(screen.getByText(/lost when it restarts/)).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'OK' }));
        await waitFor(() => expect(screen.queryByText("Your keyboard can't save changes")).toBeNull());
        expect(svc.clearStorageReset).not.toHaveBeenCalled();
    });

    it('shows the save warning first, then the reset notice', async () => {
        keyboardContext.keyboard = { kbid: 'abc', storage_reset: true, storage_write_failed: true };
        render(<StorageResetDialog />);
        expect(screen.getByText("Your keyboard can't save changes")).toBeTruthy();
        expect(screen.queryByText("Your keyboard's settings were reset")).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'OK' }));
        await waitFor(() => expect(screen.getByText("Your keyboard's settings were reset")).toBeTruthy());
        fireEvent.click(screen.getByRole('button', { name: 'OK' }));
        await waitFor(() => expect(svc.clearStorageReset).toHaveBeenCalledTimes(1));
    });

    describe('A4: new firmware reset the settings, with no update in flight', () => {
        const snap = (id: string, savedAt: number, fingerprint = id) => ({ id, boardKey: 'sval:1', boardName: 'Kip', savedAt, kind: 'pre-update', fromTag: 'v3', fingerprint });

        it('offers the newest backup of this board and puts it back, then clears the notice', async () => {
            keyboardContext.keyboard = { kbid: 'abc', storage_build_reset: true };
            backups.snapshots = [snap('old', 1000), snap('new', 2000), { ...snap('other', 3000), boardKey: 'sval:2' }];
            render(<StorageResetDialog />);
            expect(screen.getByText('New firmware reset your settings')).toBeTruthy();
            expect(screen.getByText(/Kip · v3 ·/)).toBeTruthy();
            fireEvent.click(screen.getByRole('button', { name: 'Put my layout back' }));
            await waitFor(() => expect(restore.restoreLayoutToBoard).toHaveBeenCalledTimes(1));
            expect(backupService.getSvil).toHaveBeenCalledWith('new');
            expect(restore.restoreLayoutToBoard.mock.calls[0][0]).toBe('{"backup":true}');
            await waitFor(() => expect(svc.clearStorageReset).toHaveBeenCalledTimes(1));
        });

        it('Start from defaults clears the notice without writing anything', async () => {
            keyboardContext.keyboard = { kbid: 'abc', storage_build_reset: true };
            backups.snapshots = [snap('new', 2000)];
            render(<StorageResetDialog />);
            fireEvent.click(screen.getByRole('button', { name: 'Start from defaults' }));
            await waitFor(() => expect(svc.clearStorageReset).toHaveBeenCalledTimes(1));
            expect(restore.restoreLayoutToBoard).not.toHaveBeenCalled();
        });

        it('Other backups opens Backups', async () => {
            keyboardContext.keyboard = { kbid: 'abc', storage_build_reset: true };
            backups.snapshots = [snap('new', 2000)];
            const opened = vi.fn();
            window.addEventListener(OPEN_BACKUPS_EVENT, opened);
            render(<StorageResetDialog />);
            fireEvent.click(screen.getByRole('button', { name: 'Other backups' }));
            expect(opened).toHaveBeenCalled();
            window.removeEventListener(OPEN_BACKUPS_EVENT, opened);
        });

        it('stays out of the way while this tab has an update in flight', () => {
            keyboardContext.keyboard = { kbid: 'abc', storage_build_reset: true };
            sessionStorage.setItem('keybard:firmware-update', JSON.stringify({ phase: 'running' }));
            render(<StorageResetDialog />);
            expect(screen.queryByText('New firmware reset your settings')).toBeNull();
        });

        it('bit 0 keeps its own dialog and gains the same button', () => {
            backups.snapshots = [snap('new', 2000)];
            render(<StorageResetDialog />);
            expect(screen.getByText("Your keyboard's settings were reset")).toBeTruthy();
            expect(screen.getByRole('button', { name: 'Put my layout back' })).toBeTruthy();
        });
    });
});
