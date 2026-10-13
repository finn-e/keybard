import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TrackballMismatchDialog } from '../../src/components/TrackballMismatchDialog';
import { parsePointingHardware } from '../../src/utils/pointing-hardware';

const keyboardContext = vi.hoisted(() => ({ isConnected: true, keyboard: {} as Record<string, unknown> }));
vi.mock('@/contexts/KeyboardContext', () => ({ useKeyboard: () => keyboardContext }));

const report = (usb: number[], other: number[]) => parsePointingHardware(new Uint8Array([0x2c, 1, ...usb, ...other]));

describe('TrackballMismatchDialog', () => {
    beforeEach(() => {
        keyboardContext.isConnected = true;
        // PMW3360 firmware on both halves of a PMW3389 board, as in svalboard/qmk#13.
        keyboardContext.keyboard = { kbid: 'abc', pointing_hardware: report([0x03, 1, 2, 0x47, 0xb8], [0x01, 1, 2, 0x47, 0xb8]) };
    });

    it('names the problem and the .uf2 for each half, and closes on OK', async () => {
        render(<TrackballMismatchDialog />);
        expect(screen.getByText('Wrong trackball firmware')).toBeTruthy();
        expect(screen.getAllByText(/firmware is for a PMW3360 trackball sensor, but its/)).toHaveLength(2);
        expect(screen.getByText('svalboard_trackball_pmw3389_left_sval_<release>.uf2')).toBeTruthy();
        expect(screen.getByText('svalboard_trackball_pmw3389_right_sval_<release>.uf2')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'OK' }));
        await waitFor(() => expect(screen.queryByText('Wrong trackball firmware')).toBeNull());
    });

    it('stays hidden when everything matches, nothing was reported, or the board is disconnected', () => {
        keyboardContext.keyboard = { kbid: 'abc', pointing_hardware: report([0x07, 2, 2, 0x47, 0xb8], [0x05, 2, 2, 0x47, 0xb8]) };
        const { rerender } = render(<TrackballMismatchDialog />);
        expect(screen.queryByRole('dialog')).toBeNull();
        keyboardContext.keyboard = { kbid: 'abc' };
        rerender(<TrackballMismatchDialog />);
        expect(screen.queryByRole('dialog')).toBeNull();
        keyboardContext.keyboard = { kbid: 'abc', pointing_hardware: report([0x03, 1, 2, 0x47, 0xb8], [0, 0, 0, 0, 0]) };
        keyboardContext.isConnected = false;
        rerender(<TrackballMismatchDialog />);
        expect(screen.queryByRole('dialog')).toBeNull();
    });
});
