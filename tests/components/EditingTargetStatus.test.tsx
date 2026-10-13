import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import EditingTargetStatus, { FIRMWARE_CHIP_MS } from '../../src/components/EditingTargetStatus';
const state = vi.hoisted(() => ({keyboard: {name: 'Board'} as {name: string; keycode_version?: string; svil_proto?: number; feature_flags?: number; feature_flags2?: number; keycode_version_reported?: boolean}, isConnected: false, loadedFrom: 'layout.svil', connectionState: 'offline', connectionError: null as string | null, connectionFirmware: null as {kind: 'svalboard-vial'} | null, dismissConnectionError: vi.fn(), isChangingTarget: false, connectionSessionId: 1}));
vi.mock('@/contexts/KeyboardContext', () => ({useKeyboard: () => state}));
describe('editing target status', () => {
    beforeEach(() => {state.keyboard = {name: 'Board'}; state.isConnected = false; state.connectionError = null; state.connectionFirmware = null; state.isChangingTarget = false; localStorage.clear();});
    it('identifies offline files and explains export without requiring the toolbar to be open', () => {
        render(<EditingTargetStatus />);
        expect(screen.getByRole('status')).toHaveTextContent('Offline draft: layout.svil');
        expect(screen.getByRole('status')).toHaveTextContent('Export to keep edits');
    });
    it('identifies a connected keyboard without claiming edits are saved', () => {
        state.isConnected = true;
        render(<EditingTargetStatus />);
        expect(screen.getByRole('status')).toHaveTextContent('Editing keyboard');
        expect(screen.queryByText(/No keyboard writes/)).not.toBeInTheDocument();
    });
    it('keeps connection errors and transition status visible', () => {
        state.isChangingTarget = true;
        state.connectionError = 'Connection interrupted';
        render(<EditingTargetStatus />);
        expect(screen.getByRole('status')).toHaveTextContent('Changing connection');
        expect(screen.getByRole('alert')).toHaveTextContent('Connection interrupted');
    });
    it('warns when the keyboard uses a keycode numbering Keybard does not know', () => {
        state.isConnected = true;
        state.keyboard = {name: 'Board', keycode_version: '0.0.12'};
        render(<EditingTargetStatus />);
        expect(screen.getByRole('alert')).toHaveTextContent('numbers keycodes as QMK 0.0.12');
    });
    it('suggests newer firmware to a board on a release candidate', () => {
        state.isConnected = true;
        state.keyboard = {name: 'Board', keycode_version: '0.0.9', svil_proto: 3, feature_flags: 0x60, keycode_version_reported: false};
        render(<EditingTargetStatus />);
        expect(screen.getByRole('note')).toHaveTextContent('Newer Svalboard firmware is available');
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
    it('shows the firmware card when a reconnect finds old firmware', () => {
        state.connectionError = 'old Vial firmware';
        state.connectionFirmware = {kind: 'svalboard-vial'};
        render(<EditingTargetStatus />);
        expect(screen.getByRole('alert')).toHaveTextContent('File > Save current layout');
    });
    it('lets the firmware card be dismissed while the draft or board stays open', () => {
        state.isConnected = true;
        state.connectionError = 'old Vial firmware';
        state.connectionFirmware = {kind: 'svalboard-vial'};
        render(<EditingTargetStatus />);
        fireEvent.click(screen.getByRole('button', {name: 'Dismiss'}));
        expect(state.dismissConnectionError).toHaveBeenCalled();
    });
    it('says nothing about a keycode numbering it knows', () => {
        state.isConnected = true;
        state.keyboard = {name: 'Board', keycode_version: '0.0.9'};
        render(<EditingTargetStatus />);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
    describe('firmware', () => {
        afterEach(() => { vi.useRealTimers(); });
        const vLaunch2 = {name: 'Board', keycode_version: '0.0.9', svil_proto: 3, feature_flags: 0x6f, feature_flags2: 0x01, keycode_version_reported: true};

        it('names the firmware briefly after connecting, then hides it', () => {
            vi.useFakeTimers();
            state.isConnected = true;
            state.keyboard = vLaunch2;
            render(<EditingTargetStatus />);
            expect(screen.getByRole('status')).toHaveTextContent('Firmware: Svalboard QMK vLaunch2 or later');
            expect(screen.getByTestId('firmware-chip')).toHaveTextContent('vLaunch2 or later');
            expect(screen.queryByRole('note')).not.toBeInTheDocument();
            act(() => { vi.advanceTimersByTime(FIRMWARE_CHIP_MS); });
            expect(screen.queryByTestId('firmware-chip')).not.toBeInTheDocument();
            expect(screen.getByRole('status')).toHaveTextContent('vLaunch2');
        });

        it('suggests vLaunch2 to a board on vLaunch', () => {
            state.isConnected = true;
            state.keyboard = {...vLaunch2, feature_flags2: 0};
            render(<EditingTargetStatus />);
            expect(screen.getByTestId('firmware-chip')).toHaveTextContent('Svalboard QMK vLaunch');
            expect(screen.getByRole('note')).toHaveTextContent('(vLaunch2) is available');
        });

        it('shows nothing for a loaded file', () => {
            render(<EditingTargetStatus />);
            expect(screen.queryByTestId('firmware-chip')).not.toBeInTheDocument();
            expect(screen.getByRole('status')).not.toHaveTextContent('Firmware');
        });
    });
});
