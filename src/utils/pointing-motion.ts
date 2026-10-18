// Sval POINTING_MOTION (0x2D): each hand's pointing motion since the previous
// read (read-and-clear), and the pointing modes in force. Drives the live
// pointing devices drawn in the layout. See Svalboard QMK
// keyboards/svalboard/docs/protocol.md, "Pointing motion".

import type { PadContact } from "./pointing-contacts";
import { parseVelocityScroll, type VelocityScrollState } from "./velocity-scroll";

/** GET_INFO second feature byte: the board answers POINTING_MOTION (0x2D). */
export const SVIL_FLAG2_POINTING_MOTION = 0x08;
/**
 * GET_INFO second feature byte: 0x2D keeps counts per reader id, so Keybard and
 * Keybard Host polling one board each see all of the motion, and reports each
 * hand's CPI.
 */
export const SVIL_FLAG2_POINTING_MOTION_READERS = 0x10;
/** The reader id Keybard names in its 0x2D requests (Keybard Host is 2). */
export const KEYBARD_MOTION_READER = 1;

/** Format byte this parser understands. 0 means the firmware has nothing to report. */
export const POINTING_MOTION_FORMAT = 1;

export type PointingSide = "left" | "right";
export type AxisLock = "free" | "vertical" | "horizontal";

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
    /** Raw sensor counts, +right / +down, before sniper and boost. */
    dx: number;
    dy: number;
    h: number;
    v: number;
    buttons: number;
    /** 0..255; only meaningful when touchValid. */
    touchX: number;
    touchY: number;
    /** The hand's sensor CPI when the board reports it (a trackball on newer firmware). */
    cpi?: number;
    /**
     * Every finger down on this hand's touchpad, at its place on the pad, when the
     * board reports contacts (POINTING_CONTACTS, 0x2F, native touchpad). Present
     * (possibly empty) means the pad is drawn from these and not from dx/dy.
     */
    contacts?: PadContact[];
}

export interface PointingMotionReport {
    sniper: boolean;
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
    /**
     * Velocity Scroll's state and curves, on firmware that reports them (a
     * 64-byte reply with the block at 29-52). Absent: no pill, nothing drawn.
     */
    velocityScroll?: VelocityScrollState;
}

const HALF_BYTES = 10;
/** Command echo + 24 payload bytes. */
const REPLY_BYTES = 2 + 24;
/** Command echo + the 24 bytes + reader id and each hand's CPI (64-byte reports). */
const EXT_REPLY_BYTES = 2 + 29;

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

/** Adds the extension's CPI (0 means none) when the reply carries it. */
function withCpi(half: PointingMotionHalf, view: DataView, off: number): PointingMotionHalf {
    if (view.byteLength < EXT_REPLY_BYTES) return half;
    const cpi = view.getUint16(off, true);
    return cpi > 0 ? { ...half, cpi } : half;
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
    const velocityScroll = parseVelocityScroll(view, p);
    return {
        sniper: (mode & 0x01) !== 0,
        boost: (mode & 0x02) !== 0,
        autoMouseLayer: (mode & 0x04) !== 0,
        axisLockEnabled: (mode & 0x08) !== 0,
        naturalScroll: (mode & 0x10) !== 0,
        scrollKey: (mode & 0x20) !== 0,
        elapsedMs: view.getUint8(p + 2),
        axisLock: axis === 1 ? "vertical" : axis === 2 ? "horizontal" : "free",
        left: withCpi(parseHalf(view, p + 3), view, p + 25),
        right: withCpi(parseHalf(view, p + 3 + HALF_BYTES), view, p + 27),
        ...(velocityScroll ? { velocityScroll } : {}),
    };
}
