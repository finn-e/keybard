// Sval POINTING_CONTACTS (0x2F): every touch contact down now, each on its own
// pad, from the native touchpad. With the native touchpad the computer owns the
// pads and POINTING_MOTION carries no touch positions, so this is what places
// each finger where it is. A snapshot: reading clears nothing. See Svalboard QMK
// keyboards/svalboard/docs/protocol.md, "Pointing contacts".

import type { PointingMotionReport, PointingSide } from "./pointing-motion";

/** GET_INFO second feature byte: the board answers POINTING_CONTACTS (0x2F). */
export const SVIL_FLAG2_POINTING_CONTACTS = 0x20;
export const POINTING_CONTACTS_FORMAT = 1;
/** Counts across one pad (x) and down it (y). */
export const PAD_COUNTS_X = 2048;
export const PAD_COUNTS_Y = 1792;

/** One finger on a pad. x and y run -1..1 from the pad's left and top edges to its right and bottom ones. */
export interface PadContact {
    id: number;
    x: number;
    y: number;
    /** Clear: the touchpad has flagged it as a palm. */
    confident: boolean;
    /**
     * A finger the touchpad left out (it reports at most 5): the board still
     * lists it, with bit 7 set and an ID from its own space. Drawn like any
     * other finger; its ID and this flag together identify it.
     */
    leftOut?: boolean;
}

/** One key per finger: a left-out contact's ID space is its own. */
export function contactKey(c: Pick<PadContact, "id" | "leftOut">): number {
    return c.leftOut ? 16 + c.id : c.id;
}

export interface PointingContactsReport {
    /** The touchpad is reporting to the computer (otherwise no contacts are known). */
    reporting: boolean;
    /** Which pads are part of the touchpad. */
    pads: Record<PointingSide, boolean>;
    /** The fingers down on each pad (lifting contacts are left out). */
    left: PadContact[];
    right: PadContact[];
}

/**
 * The most contacts a reply carries: three fingers on each pad. Firmware that
 * sends at most 5 says so in its count byte, and its replies parse the same.
 */
export const MAX_CONTACTS = 6;
/** Command echo, then format, flags, age and count. */
const HEADER_BYTES = 1 + 4;
const CONTACT_BYTES = 4;

/** A pad count to the drawing's -1..1 range: 0 is one edge, max - 1 the other. */
export function padUnit(count: number, counts: number): number {
    const c = Math.max(0, Math.min(counts - 1, count));
    return (c / (counts - 1)) * 2 - 1;
}

/**
 * Parses a POINTING_CONTACTS reply (command echo first). The count byte says
 * how many contacts follow (up to MAX_CONTACTS), so a 5-contact and a
 * 6-contact firmware read alike. Null unless the echo matches, the format is 1
 * and the reply holds every contact its count names.
 */
export function parsePointingContacts(reply: Uint8Array, cmd = 0x2f): PointingContactsReport | null {
    if (!reply || reply.length < HEADER_BYTES || reply[0] !== cmd || reply[1] !== POINTING_CONTACTS_FORMAT) return null;
    const p = 1; // payload offset 0 = format byte
    const flags = reply[p + 1];
    const n = Math.min(MAX_CONTACTS, reply[p + 3]);
    if (reply.length < HEADER_BYTES + CONTACT_BYTES * n) return null;
    const out: PointingContactsReport = {
        reporting: (flags & 0x01) !== 0,
        pads: { left: (flags & 0x02) !== 0, right: (flags & 0x04) !== 0 },
        left: [],
        right: [],
    };
    for (let i = 0; i < n; i++) {
        const o = HEADER_BYTES + CONTACT_BYTES * i;
        const b = reply[o];
        if (!(b & 0x10)) continue; // tip off: lifting
        const w = reply[o + 1] | (reply[o + 2] << 8) | (reply[o + 3] << 16);
        const contact: PadContact = {
            id: b & 0x0f,
            x: padUnit(w & 0xfff, PAD_COUNTS_X),
            y: padUnit((w >> 12) & 0xfff, PAD_COUNTS_Y),
            confident: (b & 0x20) !== 0,
            ...(b & 0x80 ? { leftOut: true } : {}),
        };
        (b & 0x40 ? out.right : out.left).push(contact);
    }
    return out;
}

/**
 * The motion report with each pad's contacts on its hand. A pad that is part of
 * the touchpad gets its list (empty when no finger is down), so it is drawn
 * from contacts and not from dx/dy; other hands, and a failed read, are left
 * as they were.
 */
export function withPadContacts(report: PointingMotionReport, contacts: PointingContactsReport | null): PointingMotionReport {
    if (!contacts?.reporting) return report;
    const on = (side: PointingSide) => (contacts.pads[side] ? { ...report[side], contacts: contacts[side] } : report[side]);
    return { ...report, left: on("left"), right: on("right") };
}
