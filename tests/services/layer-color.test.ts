import { describe, it, expect, vi } from 'vitest';
import { SvilUSB } from '../../src/services/usb.service';

const SET = SvilUSB.CMD_VIA_LIGHTING_SET_VALUE;
const GET = SvilUSB.CMD_VIA_LIGHTING_GET_VALUE;
const SAVE = SvilUSB.CMD_VIA_LIGHTING_SAVE;

/**
 * Fakes the board's VIA custom values on channel 0. `withVal` is firmware that keeps a
 * per-layer brightness at IDs 48-63; without it the board only knows hue/sat at 32-47
 * and, like released firmware, leaves the buffer as sent for any other ID.
 */
function fakeBoard(withVal: boolean) {
    const store = new Map<number, number[]>();
    const calls: number[][] = [];
    const usb = new SvilUSB();
    vi.spyOn(usb, 'send').mockImplementation(async (cmd: number, args: number[] = []) => {
        calls.push([cmd, ...args]);
        const [, id, ...data] = args;
        const known = (id >= 32 && id < 48) || (withVal && id >= 48 && id < 64);
        if (cmd === SET && known) store.set(id, id >= 48 ? data.slice(0, 1) : data.slice(0, 2));
        if (cmd === GET) {
            const reply = new Uint8Array(29); // the report after cmd, channel, value_id
            reply.set(data);
            if (known) reply.set(store.get(id) ?? []);
            return reply;
        }
        return new Uint8Array(29);
    });
    return { usb, store, calls };
}

describe('layer LED color', () => {
    it('sends brightness with hue and saturation, then saves', async () => {
        const { usb, calls } = fakeBoard(true);
        await usb.setLayerColor(3, 85, 200, 100);
        expect(calls).toEqual([[SET, 0, 35, 85, 200], [SET, 0, 51, 100], [SAVE, 0]]);
    });

    it('reads brightness back from firmware that stores it', async () => {
        const { usb } = fakeBoard(true);
        await usb.setLayerColor(2, 10, 20, 100);
        await expect(usb.getLayerColor(2)).resolves.toEqual({ hue: 10, sat: 20, val: 100 });
    });

    it('keeps brightness 0 distinct from "not set"', async () => {
        const { usb } = fakeBoard(true);
        await usb.setLayerColor(0, 10, 20, 0);
        await expect(usb.getLayerColor(0)).resolves.toEqual({ hue: 10, sat: 20, val: 0 });
    });

    it('reports full brightness on firmware without per-layer brightness', async () => {
        const { usb } = fakeBoard(false);
        await usb.setLayerColor(1, 10, 20, 100);
        await expect(usb.getLayerColor(1)).resolves.toEqual({ hue: 10, sat: 20, val: 255 });
    });
});
