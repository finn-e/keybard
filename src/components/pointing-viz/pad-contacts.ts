// Where the drawn touchpad puts its fingers. Pure, so the placement is tested
// without a canvas.

import { contactKey, type PadContact } from "@/utils/pointing-contacts";

/** A drawn finger: -1..1 across and down the pad, easing in and out by press. */
export interface Finger {
    x: number;
    y: number;
    press: number;
    down: boolean;
}

/**
 * Makes the drawn fingers match the board's contacts: each contact ID moves to
 * its reported place (a new one appears there), and a finger whose ID is gone
 * lifts where it was. Returns whether anything changed.
 */
export function syncFingers(fingers: Map<number, Finger>, contacts: readonly PadContact[]): boolean {
    let changed = false;
    const seen = new Set<number>();
    for (const c of contacts) {
        const key = contactKey(c);
        seen.add(key);
        const f = fingers.get(key);
        if (!f || !f.down) {
            fingers.set(key, { x: c.x, y: c.y, press: f?.press ?? 0, down: true });
            changed = true;
        } else if (f.x !== c.x || f.y !== c.y) {
            f.x = c.x;
            f.y = c.y;
            changed = true;
        }
    }
    for (const [id, f] of fingers) {
        if (f.down && !seen.has(id)) {
            f.down = false;
            changed = true;
        }
    }
    return changed;
}

/**
 * Where the one drawn fingertip goes from a hand that reports only motion (no
 * contacts: a touchpad the board drives as a mouse). An absolute touch position
 * wins. Otherwise the motion moves it, and a new touch (after a lift) starts at
 * the pad's center: relative motion says nothing about where a finger landed, so
 * it must never pile up from one touch to the next against an edge.
 */
export function padFromRelative(
    from: { x: number; y: number },
    half: { dx: number; dy: number; touchValid: boolean; touchX: number; touchY: number },
    newTouch: boolean,
    countsPerHalf: number,
): { x: number; y: number } {
    if (half.touchValid) return { x: (half.touchX / 255) * 2 - 1, y: (half.touchY / 255) * 2 - 1 };
    const x0 = newTouch ? 0 : from.x, y0 = newTouch ? 0 : from.y;
    const clamp = (v: number) => Math.max(-1, Math.min(1, v));
    return { x: clamp(x0 + half.dx / countsPerHalf), y: clamp(y0 + half.dy / countsPerHalf) };
}
