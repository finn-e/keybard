import { describe, it, expect } from 'vitest';
import { findPointingProblems, firmwareFile, parsePointingHardware } from '../../src/utils/pointing-hardware';

// One half's block: [flags] [built_for] [detected] [id0] [id1]
const LEFT = 0x03, RIGHT = 0x01, INIT_OK = 0x04;
// built_for / detected codes
const NONE = 0, PMW3360 = 1, PMW3389 = 2, NOTHING = 3, UNKNOWN = 4, AZOTEQ = 5, TRACKPOINT = 6;
const reply = (usb: number[], other: number[] = [0, 0, 0, 0, 0]) => new Uint8Array([0x2c, 1, ...usb, ...other, ...new Array(15).fill(0)]);

describe('parsePointingHardware', () => {
    it('reads both halves', () => {
        const report = parsePointingHardware(reply([LEFT | INIT_OK, PMW3389, PMW3389, 0x47, 0xb8], [RIGHT, PMW3360, PMW3389, 0x47, 0xb8]));
        expect(report?.halves).toEqual([
            { usb: true, side: 'left', builtFor: 'pmw3389', detected: 'pmw3389', sensorStarted: true, productId: 0x47, inverseProductId: 0xb8 },
            { usb: false, side: 'right', builtFor: 'pmw3360', detected: 'pmw3389', sensorStarted: false, productId: 0x47, inverseProductId: 0xb8 },
        ]);
    });

    it('reads every module type, a build without one, and "not checked yet"', () => {
        const halves = (block: number[]) => parsePointingHardware(reply(block))!.halves[0];
        expect(halves([LEFT | INIT_OK, AZOTEQ, AZOTEQ, 0, 40])).toMatchObject({ builtFor: 'azoteq', detected: 'azoteq' });
        expect(halves([LEFT | INIT_OK, TRACKPOINT, TRACKPOINT, 0, 0])).toMatchObject({ builtFor: 'trackpoint', detected: 'trackpoint' });
        expect(halves([LEFT, NONE, NOTHING, 0, 0])).toMatchObject({ builtFor: 'none', detected: 'none' });
        expect(halves([LEFT, NONE, 0, 0, 0])).toMatchObject({ builtFor: 'none', detected: null });
        expect(halves([LEFT, PMW3360, UNKNOWN, 0x12, 0x34])).toMatchObject({ detected: 'unknown' });
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

describe('firmwareFile', () => {
    it('names each release asset as svalboard/qmk does', () => {
        expect(firmwareFile('pmw3389', 'left')).toBe('svalboard_trackball_pmw3389_left_sval_<release>.uf2');
        expect(firmwareFile('azoteq', 'right')).toBe('svalboard_azoteq_right_sval_<release>.uf2');
        expect(firmwareFile('trackpoint', 'left')).toBe('svalboard_trackpoint_left_sval_<release>.uf2');
        expect(firmwareFile('none', 'right')).toBe('svalboard_right_sval_<release>.uf2');
    });
});

describe('findPointingProblems', () => {
    const problems = (usb: number[], other?: number[]) => findPointingProblems(parsePointingHardware(reply(usb, other)));

    it('is quiet when firmware matches each module and the halves differ in side', () => {
        expect(problems([LEFT | INIT_OK, PMW3389, PMW3389, 0x47, 0xb8], [RIGHT | INIT_OK, PMW3389, PMW3389, 0x47, 0xb8])).toEqual([]);
        expect(problems([LEFT | INIT_OK, AZOTEQ, AZOTEQ, 0, 40], [RIGHT | INIT_OK, TRACKPOINT, TRACKPOINT, 0, 0])).toEqual([]);
        expect(problems([LEFT, NONE, NOTHING, 0, 0], [RIGHT, NONE, 0, 0, 0])).toEqual([]);
        expect(findPointingProblems(undefined)).toEqual([]);
    });

    it('names the .uf2 for the trackball sensor that is really there (PMW3360 firmware on PMW3389 boards)', () => {
        const found = problems([LEFT, PMW3360, PMW3389, 0x47, 0xb8], [RIGHT, PMW3360, PMW3389, 0x47, 0xb8]);
        expect(found.map((p) => p.kind)).toEqual(['wrong-module', 'wrong-module']);
        expect(found.map((p) => p.kind === 'wrong-module' && p.file)).toEqual([
            'svalboard_trackball_pmw3389_left_sval_<release>.uf2',
            'svalboard_trackball_pmw3389_right_sval_<release>.uf2',
        ]);
    });

    it('names the .uf2 for a trackpad or TrackPoint on other firmware, including a build without pointing support', () => {
        expect(problems([LEFT, PMW3389, AZOTEQ, 0, 40])).toMatchObject([{ kind: 'wrong-module', builtFor: 'pmw3389', actual: 'azoteq', file: 'svalboard_azoteq_left_sval_<release>.uf2' }]);
        expect(problems([RIGHT, AZOTEQ, TRACKPOINT, 0, 0])).toMatchObject([{ kind: 'wrong-module', actual: 'trackpoint', file: 'svalboard_trackpoint_right_sval_<release>.uf2' }]);
        expect(problems([RIGHT, NONE, PMW3360, 0x42, 0xbd])).toMatchObject([{ kind: 'wrong-module', builtFor: 'none', file: 'svalboard_trackball_pmw3360_right_sval_<release>.uf2' }]);
    });

    it('reports a pointing build where nothing answered, and an unknown trackball sensor that did not start', () => {
        expect(problems([LEFT, PMW3389, NOTHING, 0, 0])).toMatchObject([{ kind: 'no-module', builtFor: 'pmw3389', file: 'svalboard_left_sval_<release>.uf2' }]);
        expect(problems([LEFT, TRACKPOINT, NOTHING, 0, 0])).toMatchObject([{ kind: 'no-module', builtFor: 'trackpoint' }]);
        expect(problems([LEFT, PMW3389, UNKNOWN, 0x12, 0x34]).map((p) => p.kind)).toEqual(['unknown-sensor']);
        expect(problems([LEFT | INIT_OK, PMW3389, UNKNOWN, 0x12, 0x34])).toEqual([]);
    });

    it('waits for halves that have not been checked yet', () => {
        expect(problems([LEFT, NONE, 0, 0, 0], [RIGHT, PMW3389, 0, 0, 0])).toEqual([]);
    });
});
