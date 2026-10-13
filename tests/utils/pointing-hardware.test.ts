import { describe, it, expect } from 'vitest';
import { findPointingProblems, parsePointingHardware, trackballFirmwareFile } from '../../src/utils/pointing-hardware';

// One half's block: [flags] [built_for] [detected] [Product_ID] [Inverse_Product_ID]
const LEFT = 0x03, RIGHT = 0x01, INIT_OK = 0x04;
const reply = (usb: number[], other: number[] = [0, 0, 0, 0, 0]) => new Uint8Array([0x2c, 1, ...usb, ...other, ...new Array(15).fill(0)]);

describe('parsePointingHardware', () => {
    it('reads both halves', () => {
        const report = parsePointingHardware(reply([LEFT | INIT_OK, 2, 2, 0x47, 0xb8], [RIGHT, 1, 2, 0x47, 0xb8]));
        expect(report?.halves).toEqual([
            { usb: true, side: 'left', builtFor: 'pmw3389', detected: 'pmw3389', sensorStarted: true, productId: 0x47, inverseProductId: 0xb8 },
            { usb: false, side: 'right', builtFor: 'pmw3360', detected: 'pmw3389', sensorStarted: false, productId: 0x47, inverseProductId: 0xb8 },
        ]);
    });

    it('keeps only the USB half while the other half has not reported', () => {
        expect(parsePointingHardware(reply([RIGHT, 0, 0, 0, 0]))?.halves).toHaveLength(1);
    });

    it('returns null for format 0, an error reply, or a short reply', () => {
        expect(parsePointingHardware(new Uint8Array([0x2c, 0, 3, 1, 1]))).toBeNull();
        expect(parsePointingHardware(new Uint8Array([0xff, 1, 3, 1, 1, 0, 0]))).toBeNull();
        expect(parsePointingHardware(new Uint8Array([0x2c]))).toBeNull();
        expect(parsePointingHardware(reply([0, 0, 0, 0, 0]))).toBeNull();
    });
});

describe('findPointingProblems', () => {
    const problems = (usb: number[], other?: number[]) => findPointingProblems(parsePointingHardware(reply(usb, other)));

    it('is quiet when firmware matches each sensor and the halves differ in side', () => {
        expect(problems([LEFT | INIT_OK, 2, 2, 0x47, 0xb8], [RIGHT | INIT_OK, 2, 2, 0x47, 0xb8])).toEqual([]);
        expect(findPointingProblems(undefined)).toEqual([]);
    });

    it('names the .uf2 for the sensor that is really there (the issue: PMW3360 firmware on PMW3389 boards)', () => {
        const found = problems([LEFT, 1, 2, 0x47, 0xb8], [RIGHT, 1, 2, 0x47, 0xb8]);
        expect(found.map((p) => p.kind)).toEqual(['wrong-sensor', 'wrong-sensor']);
        expect(found.map((p) => p.kind === 'wrong-sensor' && p.file)).toEqual([
            'svalboard_trackball_pmw3389_left_sval_<release>.uf2',
            'svalboard_trackball_pmw3389_right_sval_<release>.uf2',
        ]);
    });

    it('reports a trackball build where no sensor answered, and an unknown sensor that did not start', () => {
        expect(problems([LEFT, 2, 3, 0, 0]).map((p) => p.kind)).toEqual(['no-sensor']);
        expect(problems([LEFT, 2, 4, 0x12, 0x34]).map((p) => p.kind)).toEqual(['unknown-sensor']);
        expect(problems([LEFT | INIT_OK, 2, 4, 0x12, 0x34])).toEqual([]);
    });

    it('ignores halves without trackball firmware', () => {
        expect(problems([LEFT, 0, 0, 0, 0], [RIGHT, 0, 0, 0, 0])).toEqual([]);
    });
});
