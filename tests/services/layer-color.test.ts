import { describe, it, expect, vi } from 'vitest';
import { SvilUSB } from '../../src/services/usb.service';

const SET = SvilUSB.CMD_VIA_LIGHTING_SET_VALUE;
const GET = SvilUSB.CMD_VIA_LIGHTING_GET_VALUE;
const SAVE = SvilUSB.CMD_VIA_LIGHTING_SAVE;

/** Records the VIA lighting commands sent; GET of rgblight brightness answers `brightness`. */
function fakeBoard(brightness = 128) {
    const calls: number[][] = [];
    const usb = new SvilUSB();
    vi.spyOn(usb, 'send').mockImplementation(async (cmd: number, args: number[] = []) => {
        calls.push([cmd, ...args]);
        const reply = new Uint8Array(29); // the report after cmd, channel, value_id
        if (cmd === GET && args[0] === 2 && args[1] === 1) reply[0] = brightness;
        return reply;
    });
    return { usb, calls };
}

describe('layer LED color', () => {
    it('sends hue and saturation, then saves', async () => {
        const { usb, calls } = fakeBoard();
        await usb.setLayerColor(3, 85, 200);
        expect(calls).toEqual([[SET, 0, 35, 85, 200], [SAVE, 0]]);
    });

    it('shows a preview color without saving it', async () => {
        const { usb, calls } = fakeBoard();
        await usb.setLayerColor(3, 85, 200, false);
        expect(calls).toEqual([[SET, 0, 35, 85, 200]]);
    });
});

describe('LED brightness', () => {
    it('reads the board-wide rgblight brightness from VIA lighting channel 2', async () => {
        const { usb, calls } = fakeBoard(200);
        await expect(usb.getLedBrightness()).resolves.toBe(200);
        expect(calls).toEqual([[GET, 2, 1]]);
    });

    it('sets it and saves channel 2', async () => {
        const { usb, calls } = fakeBoard();
        await usb.setLedBrightness(255);
        expect(calls).toEqual([[SET, 2, 1, 255], [SAVE, 2]]);
    });

    it('previews it without saving', async () => {
        const { usb, calls } = fakeBoard();
        await usb.setLedBrightness(10, false);
        expect(calls).toEqual([[SET, 2, 1, 10]]);
    });
});
