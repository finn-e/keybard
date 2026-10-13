import { describe, it, expect } from 'vitest';

import { parsePointingMotion, toLiveSample, SVIL_FLAG2_POINTING_MOTION } from '../../src/utils/pointing-motion';

/** Builds a 0x2D reply: echo, then the 24-byte payload from docs/pointing-fragments-spec.md (B3). */
function reply(o: {
    format?: number; mode?: number; elapsed?: number; axis?: number;
    left?: Partial<Half>; right?: Partial<Half>;
} = {}): Uint8Array {
    const buf = new Uint8Array(32);
    const view = new DataView(buf.buffer);
    buf[0] = 0x2d;
    buf[1] = o.format ?? 1;
    buf[2] = o.mode ?? 0;
    buf[3] = o.elapsed ?? 0;
    const half = (off: number, h: Partial<Half> = {}) => {
        buf[off] = h.flags ?? 0;
        view.setInt16(off + 1, h.dx ?? 0, true);
        view.setInt16(off + 3, h.dy ?? 0, true);
        view.setInt8(off + 5, h.h ?? 0);
        view.setInt8(off + 6, h.v ?? 0);
        buf[off + 7] = h.buttons ?? 0;
        buf[off + 8] = h.tx ?? 0;
        buf[off + 9] = h.ty ?? 0;
    };
    half(4, o.left);
    half(14, o.right);
    buf[24] = o.axis ?? 0;
    return buf;
}
interface Half { flags: number; dx: number; dy: number; h: number; v: number; buttons: number; tx: number; ty: number }

describe('parsePointingMotion', () => {
    it('advertises the flag2 bit 2', () => expect(SVIL_FLAG2_POINTING_MOTION).toBe(0x04));

    it('rejects a wrong echo, format 0 (no data) and short replies', () => {
        expect(parsePointingMotion(reply({ format: 0 }))).toBeNull();
        expect(parsePointingMotion(reply({ format: 2 }))).toBeNull();
        const bad = reply();
        bad[0] = 0x2c;
        expect(parsePointingMotion(bad)).toBeNull();
        expect(parsePointingMotion(reply().slice(0, 25))).toBeNull();
        expect(parsePointingMotion(reply().slice(0, 26))).not.toBeNull();
    });

    it('decodes the mode bits, elapsed time and axis lock', () => {
        const r = parsePointingMotion(reply({ mode: 0b111111, elapsed: 255, axis: 2 }))!;
        expect(r).toMatchObject({
            precision: true, boost: true, autoMouseLayer: true, axisLockEnabled: true,
            naturalScroll: true, scrollKey: true, elapsedMs: 255, axisLock: 'horizontal',
        });
        expect(parsePointingMotion(reply({ axis: 1 }))!.axisLock).toBe('vertical');
        expect(parsePointingMotion(reply({ axis: 0 }))!.axisLock).toBe('free');
        expect(parsePointingMotion(reply({ mode: 0x02 }))).toMatchObject({ precision: false, boost: true, naturalScroll: false });
    });

    it('decodes each hand block with signed little-endian motion', () => {
        const r = parsePointingMotion(reply({
            left: { flags: 0x01 | 0x02 | 0x04 | 0x08 | 0x10 | (2 << 5), dx: -32768, dy: 32767, h: -128, v: 127, buttons: 5, tx: 255, ty: 0 },
            right: { flags: 0x01, dx: 300, dy: -2 },
        }))!;
        expect(r.left).toEqual({
            valid: true, scrolling: true, saturated: true, autoMouse: true, touchValid: true, fingers: 2,
            dx: -32768, dy: 32767, h: -128, v: 127, buttons: 5, touchX: 255, touchY: 0,
        });
        expect(r.right).toMatchObject({ valid: true, scrolling: false, fingers: 0, dx: 300, dy: -2 });
    });

    it('reads from a subarray at an offset', () => {
        const big = new Uint8Array(40);
        big.set(reply({ left: { flags: 1, dx: -5 } }), 6);
        expect(parsePointingMotion(big.subarray(6))!.left.dx).toBe(-5);
    });
});

describe('toLiveSample', () => {
    it('returns null for an invalid hand', () => {
        const r = parsePointingMotion(reply({ left: { flags: 0, dx: 10 } }))!;
        expect(toLiveSample(r, 'left', 100, 33)).toBeNull();
    });

    it('maps the hand and the mode facts; scroll beats precision beats boost', () => {
        const r = parsePointingMotion(reply({ mode: 0x01 | 0x02 | 0x10, elapsed: 20, axis: 1, right: { flags: 0x01 | 0x02 | 0x04, dx: 4, dy: -6, v: 1, buttons: 1 } }))!;
        const s = toLiveSample(r, 'right', 500, 33)!;
        expect(s).toMatchObject({
            t: 500, dtMs: 20, dx: 4, dy: -6, v: 1, h: 0, buttons: 1, mode: 'scroll',
            scrolling: true, precision: true, boost: true, axisLock: 'vertical', naturalScroll: true, saturated: true,
        });
        expect(s.touches).toBeUndefined();
        expect(s.fingers).toBeUndefined();
        const p = toLiveSample(parsePointingMotion(reply({ mode: 0x03, left: { flags: 1 } }))!, 'left', 0, 33)!;
        expect(p.mode).toBe('precision');
        const b = toLiveSample(parsePointingMotion(reply({ mode: 0x02, left: { flags: 1 } }))!, 'left', 0, 33)!;
        expect(b.mode).toBe('boost');
        const n = toLiveSample(parsePointingMotion(reply({ left: { flags: 1 } }))!, 'left', 0, 33)!;
        expect(n.mode).toBe('pointer');
    });

    it('uses the poll interval when the firmware reports 0 ms', () => {
        const r = parsePointingMotion(reply({ elapsed: 0, left: { flags: 1 } }))!;
        expect(toLiveSample(r, 'left', 0, 41)!.dtMs).toBe(41);
    });

    it('adds touches only when touch valid, and fingers when known', () => {
        const r = parsePointingMotion(reply({ left: { flags: 0x01 | 0x10 | (1 << 5), tx: 255, ty: 51 }, right: { flags: 0x01 | (2 << 5), tx: 9 } }))!;
        const left = toLiveSample(r, 'left', 0, 33)!;
        expect(left.touches).toEqual([{ x: 1, y: 0.2 }]);
        expect(left.fingers).toBe(1);
        const right = toLiveSample(r, 'right', 0, 33)!;
        expect(right.touches).toBeUndefined();
        expect(right.fingers).toBe(2);
    });
});
