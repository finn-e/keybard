import { describe, expect, it } from "vitest";

import { padFromRelative, syncFingers, type Finger } from "@/components/pointing-viz/pad-contacts";
import { hostPointingEvent } from "@/features/trainer/host-pointing";
import { PAD_COUNTS_PER_HALF } from "@/features/pointing-demo";
import { MAX_CONTACTS, contactKey, padUnit, parsePointingContacts, withPadContacts, SVIL_FLAG2_POINTING_CONTACTS } from "@/utils/pointing-contacts";
import { parsePointingMotion } from "@/utils/pointing-motion";

/** A 0x2F reply as the firmware packs it (keyboards/svalboard/azoteq/ptp.c, sval_ptp_contacts). */
// Its length is what a report leaves after the wrapper and echo: 26 bytes on
// 32-byte reports (room for 5 contacts), 58 on 64-byte ones.
function reply(flags: number, contacts: { id: number; right?: boolean; x: number; y: number; tip?: boolean; conf?: boolean; out?: boolean }[], length = 2 + 24): Uint8Array {
    const r = new Uint8Array(length);
    r[0] = 0x2f;
    r[1] = 1;
    r[2] = flags;
    r[4] = contacts.length;
    contacts.forEach((c, i) => {
        const o = 5 + 4 * i;
        r[o] = (c.id & 15) | (c.tip === false ? 0 : 0x10) | (c.conf === false ? 0 : 0x20) | (c.right ? 0x40 : 0) | (c.out ? 0x80 : 0);
        const w = c.x | (c.y << 12);
        r[o + 1] = w & 0xff; r[o + 2] = (w >> 8) & 0xff; r[o + 3] = (w >> 16) & 0xff;
    });
    return r;
}

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 4);

describe("POINTING_CONTACTS (0x2F)", () => {
    it("is advertised by GET_INFO byte 19 bit 5", () => {
        expect(SVIL_FLAG2_POINTING_CONTACTS).toBe(0x20);
    });

    it("maps pad counts to the drawn pad: corners to its edges, middle to its center", () => {
        close(padUnit(0, 2048), -1);
        close(padUnit(2047, 2048), 1);
        close(padUnit(1023.5, 2048), 0);
        close(padUnit(0, 1792), -1);
        close(padUnit(1791, 1792), 1);
        close(padUnit(5000, 2048), 1); // out of range clamps
    });

    it("puts every contact on its own pad at its own place", () => {
        // Two fingers on the left pad (near its top-left and bottom-right), one in
        // the right pad's top-right corner: per-pad counts, never the merged surface.
        const r = parsePointingContacts(reply(7, [
            { id: 3, x: 100, y: 200 },
            { id: 4, x: 1900, y: 1700 },
            { id: 9, right: true, x: 2047, y: 0 },
        ]));
        expect(r).not.toBeNull();
        expect(r!.reporting).toBe(true);
        expect(r!.pads).toEqual({ left: true, right: true });
        expect(r!.left.map((c) => c.id)).toEqual([3, 4]);
        expect(r!.right.map((c) => c.id)).toEqual([9]);
        const [a, b] = r!.left, c = r!.right[0];
        close(a.x, (100 / 2047) * 2 - 1); close(a.y, (200 / 1791) * 2 - 1);
        close(b.x, (1900 / 2047) * 2 - 1); close(b.y, (1700 / 1791) * 2 - 1);
        close(c.x, 1); close(c.y, -1);
        // A touch in the top-left stays top-left (not mirrored, not flipped).
        expect(a.x).toBeLessThan(-0.8);
        expect(a.y).toBeLessThan(-0.7);
    });

    it("leaves out lifting contacts and keeps palms flagged", () => {
        const r = parsePointingContacts(reply(3, [
            { id: 1, x: 10, y: 10, tip: false },
            { id: 2, x: 1024, y: 896, conf: false },
        ]))!;
        expect(r.left).toHaveLength(1);
        expect(r.left[0]).toMatchObject({ id: 2, confident: false });
        close(r.left[0].x, (1024 / 2047) * 2 - 1);
    });

    it("refuses a reply with the wrong echo, format or length", () => {
        const good = reply(1, []);
        expect(parsePointingContacts(good)).not.toBeNull();
        const echo = good.slice(); echo[0] = 0x2d;
        expect(parsePointingContacts(echo)).toBeNull();
        const format = good.slice(); format[1] = 0;
        expect(parsePointingContacts(format)).toBeNull();
        expect(parsePointingContacts(good.slice(0, 4))).toBeNull();
        // A reply cut short of the contacts its count names.
        const two = reply(1, [{ id: 1, x: 1, y: 1 }, { id: 2, x: 2, y: 2 }]);
        expect(parsePointingContacts(two.slice(0, 5 + 4))).toBeNull();
        expect(parsePointingContacts(two.slice(0, 5 + 8))).not.toBeNull();
    });

    it("reads six contacts: three fingers on each pad", () => {
        expect(MAX_CONTACTS).toBe(6);
        const six = [0, 1, 2, 3, 4, 5].map((i) => ({ id: i, right: i >= 3, x: 300 * (i + 1), y: 250 * (i + 1) }));
        const r = parsePointingContacts(reply(7, six, 64 - 6))!;
        expect(r.left.map((c) => c.id)).toEqual([0, 1, 2]);
        expect(r.right.map((c) => c.id)).toEqual([3, 4, 5]);
        close(r.right[2].x, (1800 / 2047) * 2 - 1);
        close(r.right[2].y, (1500 / 1791) * 2 - 1);
    });

    it("reads three on each pad when the touchpad left one out (bit 7): a normal finger with its own ID space", () => {
        // The touchpad reports 5; the sixth finger follows with bit 7 set, and
        // its ID (3) may equal a reported finger's on the same pad.
        const r = parsePointingContacts(reply(7, [
            { id: 0, x: 100, y: 100 }, { id: 1, x: 600, y: 600 }, { id: 2, x: 1200, y: 1200 },
            { id: 3, right: true, x: 200, y: 300 }, { id: 4, right: true, x: 900, y: 900 },
            { id: 3, right: true, out: true, x: 1800, y: 1500 },
        ], 64 - 6))!;
        expect(r.left).toHaveLength(3);
        expect(r.right.map((c) => [c.id, c.leftOut ?? false])).toEqual([[3, false], [4, false], [3, true]]);
        close(r.right[2].x, (1800 / 2047) * 2 - 1);
        expect(r.right[2].confident).toBe(true);
        // Drawn as three fingers: the left-out one doesn't replace finger 3.
        const fingers = new Map<number, Finger>();
        syncFingers(fingers, r.right);
        expect([...fingers.values()].filter((f) => f.down)).toHaveLength(3);
        expect(contactKey(r.right[0])).not.toBe(contactKey(r.right[2]));
    });

    it("still reads 5-contact firmware on 32-byte reports", () => {
        const five = [0, 1, 2, 3, 4].map((i) => ({ id: i, right: i >= 2, x: 100 * i, y: 100 * i }));
        const r = parsePointingContacts(reply(7, five))!;
        expect(r.left).toHaveLength(2);
        expect(r.right).toHaveLength(3);
        // Six counted where a 32-byte report has room for five: incomplete.
        const r6 = reply(7, five);
        r6[4] = 6;
        expect(parsePointingContacts(r6)).toBeNull();
    });

    it("reads no more than six contacts, whatever the count says", () => {
        const seven = [0, 1, 2, 3, 4, 5, 6].map((i) => ({ id: i, x: 10, y: 10 }));
        expect(parsePointingContacts(reply(3, seven, 64 - 6))!.left).toHaveLength(6);
    });

    it("hands each pad's contacts to its hand of the motion report", () => {
        const motion = parsePointingMotion(new Uint8Array([0x2d, 1, ...new Array(23).fill(0), 0]))!;
        const contacts = parsePointingContacts(reply(3, [{ id: 0, x: 0, y: 1791 }]))!;
        const merged = withPadContacts(motion, contacts);
        expect(merged.left.contacts).toHaveLength(1);
        expect(merged.right.contacts).toBeUndefined(); // no pad on that hand
        // Not reporting: the motion stays as it was (drawn from dx/dy).
        expect(withPadContacts(motion, parsePointingContacts(reply(6, [])))).toBe(motion);
        expect(withPadContacts(motion, null)).toBe(motion);
    });
});

describe("drawn fingers", () => {
    it("follow the contacts: new ones appear where they are, gone ones lift in place", () => {
        const fingers = new Map<number, Finger>();
        expect(syncFingers(fingers, [{ id: 1, x: -0.5, y: 0.5, confident: true }, { id: 2, x: 0.5, y: -0.5, confident: true }])).toBe(true);
        expect([...fingers.keys()]).toEqual([1, 2]);
        expect(fingers.get(1)).toMatchObject({ x: -0.5, y: 0.5, down: true });
        expect(syncFingers(fingers, [{ id: 1, x: -0.5, y: 0.5, confident: true }, { id: 2, x: 0.5, y: -0.5, confident: true }])).toBe(false);
        expect(syncFingers(fingers, [{ id: 2, x: 0.6, y: -0.5, confident: true }])).toBe(true);
        expect(fingers.get(1)).toMatchObject({ x: -0.5, y: 0.5, down: false });
        expect(fingers.get(2)).toMatchObject({ x: 0.6, down: true });
    });

    it("never pile relative motion into a corner from one touch to the next", () => {
        // The bug: motion-only touches were summed across touches and clamped, so
        // the fingertip sat in a corner wherever the finger landed.
        let at = { x: 0, y: 0 };
        for (let touch = 0; touch < 5; touch++) {
            at = padFromRelative(at, { dx: -PAD_COUNTS_PER_HALF, dy: PAD_COUNTS_PER_HALF, touchValid: false, touchX: 0, touchY: 0 }, true, PAD_COUNTS_PER_HALF);
            expect(at).toEqual({ x: -1, y: 1 });
            at = padFromRelative(at, { dx: PAD_COUNTS_PER_HALF / 2, dy: -PAD_COUNTS_PER_HALF / 2, touchValid: false, touchX: 0, touchY: 0 }, false, PAD_COUNTS_PER_HALF);
            expect(at).toEqual({ x: -0.5, y: 0.5 });
        }
        // Each new touch starts at the center.
        const fresh = padFromRelative({ x: -1, y: 1 }, { dx: 30, dy: 0, touchValid: false, touchX: 0, touchY: 0 }, true, PAD_COUNTS_PER_HALF);
        close(fresh.x, 0.1); close(fresh.y, 0);
        // An absolute touch position wins.
        expect(padFromRelative({ x: 0, y: 0 }, { dx: 0, dy: 0, touchValid: true, touchX: 255, touchY: 0 }, true, PAD_COUNTS_PER_HALF)).toEqual({ x: 1, y: -1 });
    });
});

describe("contacts from the Overlay app", () => {
    it("pass through validated", () => {
        const r = hostPointingEvent({
            sniper: false, boost: false, elapsedMs: 16,
            left: { valid: true, contacts: [{ id: 3, x: -0.9, y: -0.8 }, { id: 4, x: 2, y: 0.9, confident: false }, { bad: 1 }] },
            right: { valid: true },
        })!;
        expect(r.left.contacts).toEqual([
            { id: 3, x: -0.9, y: -0.8, confident: true },
            { id: 4, x: 1, y: 0.9, confident: false },
        ]);
        expect(r.right.contacts).toBeUndefined();
    });

    it("pass through six contacts on a pad, and no more", () => {
        const list = [0, 1, 2, 3, 4, 5, 6].map((id) => ({ id, x: 0, y: 0 }));
        const r = hostPointingEvent({ left: { valid: true, contacts: list }, right: { valid: true, contacts: list.slice(0, 3) } })!;
        expect(r.left.contacts!.map((c) => c.id)).toEqual([0, 1, 2, 3, 4, 5]);
        expect(r.right.contacts).toHaveLength(3);
    });

    it("keep a left-out contact apart (bit 7 from the board, leftOut from the Overlay app)", () => {
        const r = hostPointingEvent({ left: { valid: true, contacts: [{ id: 3, x: 0, y: 0 }, { id: 3, x: 0.5, y: 0.5, leftOut: true }] }, right: {} })!;
        expect(r.left.contacts).toEqual([
            { id: 3, x: 0, y: 0, confident: true },
            { id: 3, x: 0.5, y: 0.5, confident: true, leftOut: true },
        ]);
    });
});
