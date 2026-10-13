// Trackball firmware vs. hardware: Sval POINTING_HARDWARE (0x2C).
//
// PMW3360 and PMW3389 trackball sensors need different firmware, and the wrong
// one leaves the trackball dead with no other sign. Svalboard QMK reports, for
// each half, its side, the sensor its firmware drives and the sensor that
// answered, so Keybard can name the .uf2 that fixes it.
//
// Reply after the wrapper: [0x2C] [format = 1] [USB half: 5 bytes] [other half: 5 bytes]
// Each half: [flags] [built_for] [detected] [Product_ID] [Inverse_Product_ID]
//   flags: bit 0 reported, bit 1 left half, bit 2 sensor driver initialized
//   built_for: 0 not a trackball build, 1 PMW3360, 2 PMW3389
//   detected: 0 not checked, 1 PMW3360, 2 PMW3389, 3 no answer, 4 some other ID
// Documented in svalboard/qmk keyboards/svalboard/docs/protocol.md.

/** GET_INFO second feature byte: the board answers POINTING_HARDWARE (0x2C). */
export const SVIL_FLAG2_POINTING_HARDWARE = 0x02;

export type TrackballSensor = "pmw3360" | "pmw3389";
export type Side = "left" | "right";

export interface PointingHalfReport {
    /** The half plugged into the computer (it answers for both). */
    usb: boolean;
    side: Side;
    /** The trackball sensor this half's firmware drives; null for other builds. */
    builtFor: TrackballSensor | null;
    /** What answered: a known sensor, "none" (no answer), "unknown" (another ID), or null (not checked). */
    detected: TrackballSensor | "none" | "unknown" | null;
    sensorStarted: boolean;
    productId: number;
    inverseProductId: number;
}

export interface PointingHardwareReport {
    /** The halves that reported: the USB half first, then the other half when it answered. */
    halves: PointingHalfReport[];
}

const FLAG_REPORTED = 0x01;
const FLAG_LEFT = 0x02;
const FLAG_INIT_OK = 0x04;
const BLOCK_SIZE = 5;

const SENSORS: Record<number, TrackballSensor> = { 1: "pmw3360", 2: "pmw3389" };

function parseHalf(bytes: Uint8Array, offset: number, usb: boolean): PointingHalfReport | null {
    if (bytes.length < offset + BLOCK_SIZE) return null;
    const flags = bytes[offset];
    if (!(flags & FLAG_REPORTED)) return null;
    const detectedCode = bytes[offset + 2];
    return {
        usb,
        side: flags & FLAG_LEFT ? "left" : "right",
        builtFor: SENSORS[bytes[offset + 1]] ?? null,
        detected: SENSORS[detectedCode] ?? (detectedCode === 3 ? "none" : detectedCode === 4 ? "unknown" : null),
        sensorStarted: (flags & FLAG_INIT_OK) !== 0,
        productId: bytes[offset + 3],
        inverseProductId: bytes[offset + 4],
    };
}

/** Parses a POINTING_HARDWARE reply (command echo first). Null when it has nothing to report. */
export function parsePointingHardware(reply: Uint8Array, cmd = 0x2c): PointingHardwareReport | null {
    if (reply.length < 2 || reply[0] !== cmd || reply[1] !== 1) return null;
    const halves = [parseHalf(reply, 2, true), parseHalf(reply, 2 + BLOCK_SIZE, false)].filter(
        (h): h is PointingHalfReport => h !== null,
    );
    return halves.length ? { halves } : null;
}

export const SENSOR_NAMES: Record<TrackballSensor, string> = { pmw3360: "PMW3360", pmw3389: "PMW3389" };

/** The release asset for a trackball half, as svalboard/qmk names them. */
export function trackballFirmwareFile(sensor: TrackballSensor, side: Side): string {
    return `svalboard_trackball_${sensor}_${side}_sval_<release>.uf2`;
}

export type PointingProblem =
    | { kind: "wrong-sensor"; half: PointingHalfReport; builtFor: TrackballSensor; actual: TrackballSensor; file: string }
    | { kind: "no-sensor"; half: PointingHalfReport; builtFor: TrackballSensor }
    | { kind: "unknown-sensor"; half: PointingHalfReport; builtFor: TrackballSensor };

/** What's wrong with the firmware on each half, if anything. */
export function findPointingProblems(report: PointingHardwareReport | null | undefined): PointingProblem[] {
    if (!report) return [];
    const problems: PointingProblem[] = [];
    for (const half of report.halves) {
        const builtFor = half.builtFor;
        if (!builtFor || half.detected === null) continue;
        if (half.detected === "none") {
            problems.push({ kind: "no-sensor", half, builtFor });
        } else if (half.detected === "unknown") {
            if (!half.sensorStarted) problems.push({ kind: "unknown-sensor", half, builtFor });
        } else if (half.detected !== builtFor) {
            problems.push({ kind: "wrong-sensor", half, builtFor, actual: half.detected, file: trackballFirmwareFile(half.detected, half.side) });
        }
    }
    return problems;
}
