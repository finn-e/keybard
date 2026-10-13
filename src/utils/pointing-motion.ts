// Sval POINTING_MOTION (0x2D): each hand's pointing motion since the previous
// read, read-and-clear. Drives the animated pointing slots in the layout viewer.
// See docs/pointing-fragments-spec.md (B3) and keyboards/svalboard/docs/protocol.md.

import { derivePointingMode, type AxisLock, type PointingLiveSample, type PointingSide } from "@/components/pointing-viz/types";

/** GET_INFO second feature byte: the board answers POINTING_MOTION (0x2D). */
export const SVIL_FLAG2_POINTING_MOTION = 0x08;

/** Format byte this parser understands. 0 means the firmware has nothing to report. */
export const POINTING_MOTION_FORMAT = 1;

export interface PointingMotionHalf {
    /** This hand has a started pointing driver whose data reaches the USB half. */
    valid: boolean;
    /** This hand's motion is being converted to scroll. */
    scrolling: boolean;
    /** dx or dy was clamped since the previous read. */
    saturated: boolean;
    autoMouse: boolean;
    touchValid: boolean;
    /** 0..3; 0 when unknown. */
    fingers: number;
    dx: number;
    dy: number;
    h: number;
    v: number;
    buttons: number;
    /** 0..255, finger 1; only meaningful when touchValid. */
    touchX: number;
    touchY: number;
}

export interface PointingMotionReport {
    precision: boolean;
    boost: boolean;
    autoMouseLayer: boolean;
    axisLockEnabled: boolean;
    naturalScroll: boolean;
    scrollKey: boolean;
    /** Milliseconds since the previous read (saturates at 255; 0 on the first read after boot). */
    elapsedMs: number;
    axisLock: AxisLock;
    left: PointingMotionHalf;
    right: PointingMotionHalf;
}

const HALF_BYTES = 10;
/** Command echo + 24 payload bytes. */
const REPLY_BYTES = 2 + 24;

function parseHalf(view: DataView, off: number): PointingMotionHalf {
    const flags = view.getUint8(off);
    return {
        valid: (flags & 0x01) !== 0,
        scrolling: (flags & 0x02) !== 0,
        saturated: (flags & 0x04) !== 0,
        autoMouse: (flags & 0x08) !== 0,
        touchValid: (flags & 0x10) !== 0,
        fingers: (flags >> 5) & 0x03,
        dx: view.getInt16(off + 1, true),
        dy: view.getInt16(off + 3, true),
        h: view.getInt8(off + 5),
        v: view.getInt8(off + 6),
        buttons: view.getUint8(off + 7),
        touchX: view.getUint8(off + 8),
        touchY: view.getUint8(off + 9),
    };
}

/**
 * Parses a POINTING_MOTION reply (command echo first). Null unless the echo
 * matches, the format is 1 and the reply is complete.
 */
export function parsePointingMotion(reply: Uint8Array, cmd = 0x2d): PointingMotionReport | null {
    if (!reply || reply.length < REPLY_BYTES || reply[0] !== cmd || reply[1] !== POINTING_MOTION_FORMAT) return null;
    const view = new DataView(reply.buffer, reply.byteOffset, reply.byteLength);
    const p = 1; // payload offset 0 = format byte
    const mode = view.getUint8(p + 1);
    const axis = view.getUint8(p + 23);
    return {
        precision: (mode & 0x01) !== 0,
        boost: (mode & 0x02) !== 0,
        autoMouseLayer: (mode & 0x04) !== 0,
        axisLockEnabled: (mode & 0x08) !== 0,
        naturalScroll: (mode & 0x10) !== 0,
        scrollKey: (mode & 0x20) !== 0,
        elapsedMs: view.getUint8(p + 2),
        axisLock: axis === 1 ? "vertical" : axis === 2 ? "horizontal" : "free",
        left: parseHalf(view, p + 3),
        right: parseHalf(view, p + 3 + HALF_BYTES),
    };
}

/**
 * One hand's live sample from a report. Null when that hand isn't valid.
 * dtMs is the firmware's elapsed time, or `fallbackDtMs` (the poll interval)
 * when the firmware reports 0.
 */
export function toLiveSample(r: PointingMotionReport, side: PointingSide, now: number, fallbackDtMs: number): PointingLiveSample | null {
    const half = side === "left" ? r.left : r.right;
    if (!half.valid) return null;
    const flags = { scrolling: half.scrolling, precision: r.precision, boost: r.boost };
    const sample: PointingLiveSample = {
        t: now,
        dtMs: r.elapsedMs || fallbackDtMs,
        dx: half.dx,
        dy: half.dy,
        h: half.h,
        v: half.v,
        buttons: half.buttons,
        mode: derivePointingMode(flags),
        ...flags,
        axisLock: r.axisLock,
        naturalScroll: r.naturalScroll,
        autoMouseLayer: r.autoMouseLayer,
        saturated: half.saturated,
    };
    if (half.touchValid) sample.touches = [{ x: half.touchX / 255, y: half.touchY / 255 }];
    if (half.fingers > 0) sample.fingers = half.fingers;
    return sample;
}
