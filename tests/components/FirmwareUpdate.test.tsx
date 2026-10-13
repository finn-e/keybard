import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FirmwareUpdateNote, UnsupportedFirmwareCard } from '../../src/components/FirmwareUpdate';
import { LATEST_FIRMWARE_RELEASE, SVALBOARD_FIRMWARE_URL, describeFirmware, firmwareUpdateNotice, identifyFirmwareRelease } from '../../src/constants/firmware';

const mode = vi.hoisted(() => ({ paranoid: false }));
vi.mock('@/lib/paranoid', () => ({ get PARANOID() { return mode.paranoid; }, userIsLooking: () => true }));

describe('UnsupportedFirmwareCard', () => {
    beforeEach(() => { mode.paranoid = false; });

    it('tells a Vial Svalboard owner to save the layout and flash Svalboard QMK', () => {
        render(<UnsupportedFirmwareCard info={{ kind: 'svalboard-vial', reportedVersion: 'v2025-11-01' }} />);
        const card = screen.getByRole('alert');
        expect(card).toHaveTextContent('old Vial firmware (v2025-11-01)');
        expect(card).toHaveTextContent('File > Save current layout');
        expect(card).toHaveTextContent('Flash both halves');
        expect(card).toHaveTextContent('RPI-RP2');
        // The saved layout goes back in through the import control, after connecting
        expect(card).toHaveTextContent('Import Layout above the keyboard and choose your saved .vil file');
        expect(card).not.toHaveTextContent('Load File');
        const link = screen.getByRole('link');
        expect(link).toHaveAttribute('href', SVALBOARD_FIRMWARE_URL);
        expect(link).toHaveAttribute('target', '_blank');
    });

    it('sends other keyboards elsewhere without the Svalboard download', () => {
        render(<UnsupportedFirmwareCard info={{ kind: 'other-qmk' }} />);
        expect(screen.getByRole('alert')).toHaveTextContent("doesn't run Svalboard firmware");
        expect(screen.queryByRole('link')).not.toBeInTheDocument();
        expect(screen.queryByText(/Save current layout/)).not.toBeInTheDocument();
    });

    it('tells a keyboard that never answered to retry, not to reflash', () => {
        render(<UnsupportedFirmwareCard info={{ kind: 'no-response' }} />);
        const card = screen.getByRole('alert', { name: "The keyboard didn't respond" });
        expect(card).toHaveTextContent('Unplug the keyboard');
        expect(card).not.toHaveTextContent(/Vial firmware|uf2|Flash/);
        expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });

    it('shows the download address as text in Keybard Paranoid', () => {
        mode.paranoid = true;
        render(<UnsupportedFirmwareCard info={{ kind: 'unknown' }} />);
        expect(screen.queryByRole('link')).not.toBeInTheDocument();
        expect(screen.getByRole('alert')).toHaveTextContent(SVALBOARD_FIRMWARE_URL);
    });
});

describe('firmware update notice', () => {
    beforeEach(() => { localStorage.clear(); });

    it('only asks boards on an older release, on a live connection, to update', () => {
        expect(firmwareUpdateNotice({ svil_proto: 3, feature_flags: 0x6f, feature_flags2: 0x01, keycode_version_reported: true })).toBeNull();
        expect(firmwareUpdateNotice({ svil_proto: 3, feature_flags: 0x6f, keycode_version_reported: true })).toBe('launch');
        expect(firmwareUpdateNotice({ svil_proto: 3, feature_flags: 0x60, keycode_version_reported: false })).toBe('rc');
        expect(firmwareUpdateNotice({ svil_proto: 3, feature_flags: 0x0f, keycode_version_reported: false })).toBe('rc0');
        expect(firmwareUpdateNotice({ svil_proto: 3, feature_flags: 0x60 })).toBeNull(); // loaded file
        expect(firmwareUpdateNotice({ svil_proto: 4, feature_flags: 0, keycode_version_reported: false })).toBeNull();
    });

    it('explains what vLaunch2 adds to a board on vLaunch', () => {
        render(<FirmwareUpdateNote notice="launch" />);
        expect(screen.getByRole('note')).toHaveTextContent('Newer Svalboard firmware (vLaunch2) is available');
    });

    it('stays dismissed once dismissed', () => {
        const { unmount } = render(<FirmwareUpdateNote notice="rc" />);
        expect(screen.getByRole('note')).toHaveTextContent('Newer Svalboard firmware is available');
        fireEvent.click(screen.getByRole('button', { name: 'Dismiss firmware notice' }));
        expect(screen.queryByRole('note')).not.toBeInTheDocument();
        unmount();
        render(<FirmwareUpdateNote notice="rc" />);
        expect(screen.queryByRole('note')).not.toBeInTheDocument();
    });
});

describe('firmware release identification', () => {
    const live = { svil_proto: 3, keycode_version_reported: true, feature_flags: 0x6f };

    it('identifies each release from what GET_INFO reports', () => {
        expect(identifyFirmwareRelease({ svil_proto: 3, feature_flags: 0x0f, keycode_version_reported: false })).toEqual({ name: 'vRC0', orLater: false, outdated: true });
        expect(identifyFirmwareRelease({ svil_proto: 3, feature_flags: 0x6f, keycode_version_reported: false })).toEqual({ name: 'vRC1 or vRC2', orLater: false, outdated: true });
        expect(identifyFirmwareRelease({ ...live, feature_flags2: 0 })).toEqual({ name: 'vLaunch', orLater: false, outdated: true });
        expect(identifyFirmwareRelease({ ...live, feature_flags2: 0x01 })).toEqual({ name: 'vLaunch2', orLater: true, outdated: false });
    });

    it('treats vLaunch2 as the newest release it knows', () => {
        expect(LATEST_FIRMWARE_RELEASE).toBe('vLaunch2');
        expect(identifyFirmwareRelease({ ...live, svil_proto: 4 })).toEqual({ name: 'newer than vLaunch2', orLater: false, outdated: false });
    });

    it('says nothing about loaded files or unsupported protocols', () => {
        expect(identifyFirmwareRelease({ svil_proto: 3, feature_flags: 0x6f })).toBeNull();
        expect(identifyFirmwareRelease({ ...live, svil_proto: 2 })).toBeNull();
        expect(describeFirmware({ svil_proto: 3 })).toBeNull();
    });

    it('prefers the build string the board reports', () => {
        expect(describeFirmware({ ...live, feature_flags2: 1 })).toBe('Svalboard QMK vLaunch2 or later');
        expect(describeFirmware({ ...live, sval_firmware: 'svalboard/trackball/pmw3389/right:sval @ vLaunch2-3-gabc' })).toBe('svalboard/trackball/pmw3389/right:sval @ vLaunch2-3-gabc');
    });
});
