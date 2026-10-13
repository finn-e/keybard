import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import AboutPanel from '../../src/layout/SecondarySidebar/Panels/AboutPanel';
import type { KeyboardInfo } from '../../src/types/keyboard.types';

const state = vi.hoisted(() => ({ keyboard: null as Partial<KeyboardInfo> | null, isConnected: false }));
vi.mock('@/contexts/KeyboardContext', () => ({ useKeyboard: () => state }));
vi.mock('@/lib/paranoid', () => ({ PARANOID: false, userIsLooking: () => true }));

const vLaunch = { name: 'Svalboard', svil_proto: 3, feature_flags: 0x6f, feature_flags2: 0, keycode_version: '0.0.9', keycode_version_reported: true };

describe('About panel firmware', () => {
    beforeEach(() => { state.keyboard = null; state.isConnected = false; });

    it('asks for a connection when no board is connected', () => {
        render(<AboutPanel />);
        expect(screen.getByText('Connect a keyboard to see its firmware.')).toBeInTheDocument();
        expect(screen.getByText(/Newest Svalboard firmware this Keybard knows/)).toHaveTextContent('vLaunch2');
    });

    it("shows a current board's release without an update link", () => {
        state.isConnected = true;
        state.keyboard = { ...vLaunch, feature_flags2: 0x01 };
        render(<AboutPanel />);
        const details = screen.getByLabelText('Keyboard firmware');
        expect(details).toHaveTextContent('ReleasevLaunch2 or later');
        expect(details).toHaveTextContent('Sval protocol3');
        expect(details).toHaveTextContent('QMK keycodes0.0.9');
        expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });

    it('points an older board at the newer release', () => {
        state.isConnected = true;
        state.keyboard = vLaunch;
        render(<AboutPanel />);
        expect(screen.getByLabelText('Keyboard firmware')).toHaveTextContent('ReleasevLaunch');
        expect(screen.getByLabelText('Keyboard firmware')).toHaveTextContent('vLaunch2 is available');
        expect(screen.getByRole('link')).toHaveAttribute('href', 'https://github.com/svalboard/qmk/releases/latest');
    });

    it('shows the build string when the board reports one', () => {
        state.isConnected = true;
        state.keyboard = { ...vLaunch, sval_firmware: 'svalboard/trackball/pmw3389/right:sval @ vLaunch2-4-g1234' };
        render(<AboutPanel />);
        expect(screen.getByLabelText('Keyboard firmware')).toHaveTextContent('Buildsvalboard/trackball/pmw3389/right:sval @ vLaunch2-4-g1234');
    });
});
