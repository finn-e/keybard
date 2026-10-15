import { describe, expect, it } from 'vitest';
import { computeComboEditorGeometry, nearestSpot, COMBO_EDITOR_GAP as GAP, type Box, type ComboEditorGeometryInput } from '@/layout/SecondarySidebar/comboEditorGeometry';

const box = (left: number, top: number, w: number, h: number): Box => ({ left, top, right: left + w, bottom: top + h });
const overlaps = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
// A 1440x1000 sidebar layout: panel at 64..576, canvas beside it, a keyboard of
// 4 keys between y=180 and y=400.
const keys = [box(800, 180, 40, 40), box(1000, 250, 40, 40), box(1200, 300, 40, 40), box(1100, 360, 40, 40)];
const base = (over: Partial<ComboEditorGeometryInput>): ComboEditorGeometryInput => ({
    placement: 'dock', bottom: false, viewport: { width: 1440, height: 1000 },
    canvas: box(742, 74, 698, 926), panel: box(64, 8, 512, 984), editor: { width: 430, height: 100 },
    keys, triggers: [], canvasScrollTop: 0, currentReserve: 0, manual: null, ...over,
});
const placed = (g: { left: number; top: number; width?: number }, h = 100, w = 430) => box(g.left, g.top, g.width ?? w, h);

describe('combo editor geometry', () => {
    it('docks full width at the bottom of the keyboard column and reserves its height', () => {
        const g = computeComboEditorGeometry(base({ placement: 'dock' }));
        expect(g.left).toBe(742);
        expect(g.width).toBe(1440 - GAP - 742);
        expect(g.top).toBe(1000 - GAP - 100);
        expect(g.reserve).toBe(100 + 2 * GAP);
        expect(keys.some(k => overlaps(placed(g), k))).toBe(false);
    });

    it('docks above a bottom panel and to the right of nothing else', () => {
        const g = computeComboEditorGeometry(base({ placement: 'dock', bottom: true, canvas: box(64, 74, 1376, 500), panel: box(56, 600, 1384, 400) }));
        expect(g.top + 100).toBe(600 - GAP);
        expect(g.left).toBe(64 + GAP);
        expect(g.reserve).toBe(100 + 2 * GAP);
    });

    it('never places the dock over the side panel when the panel overlays the canvas', () => {
        const g = computeComboEditorGeometry(base({ placement: 'dock', canvas: box(224, 74, 800, 694), panel: box(208, 8, 512, 752), viewport: { width: 1024, height: 768 } }));
        expect(g.left).toBe(208 + 512 + GAP);
    });

    it('anchors a card under the keyboard, centered on the trigger keys', () => {
        const triggers = [keys[1], keys[2]];
        const g = computeComboEditorGeometry(base({ placement: 'anchored', triggers }));
        expect(g.top).toBe(400 + GAP);
        expect(g.left + 430 / 2).toBeCloseTo((1000 + 1240) / 2);
        expect(g.reserve).toBe(0);
    });

    it('clamps the anchored card inside the column', () => {
        const g = computeComboEditorGeometry(base({ placement: 'anchored', triggers: [box(1400, 200, 30, 30)] }));
        expect(g.left + 430).toBeLessThanOrEqual(1440 - GAP);
    });

    it('moves the anchored card to the bottom and reserves space when there is no room under the keyboard', () => {
        const g = computeComboEditorGeometry(base({ placement: 'anchored', viewport: { width: 1440, height: 480 } }));
        expect(g.top).toBe(480 - GAP - 100);
        expect(g.reserve).toBe(100 + 2 * GAP);
    });

    it('does not let go of the reserve until there is clear extra room (no flip-flop)', () => {
        // Fits by 10px, but it is reserving now: keep reserving.
        const tight = { placement: 'anchored' as const, viewport: { width: 1440, height: 400 + GAP + 100 + GAP + 10 } };
        expect(computeComboEditorGeometry(base({ ...tight, currentReserve: 116 })).reserve).toBeGreaterThan(0);
        expect(computeComboEditorGeometry(base({ ...tight, currentReserve: 0 })).reserve).toBe(0);
    });

    it('ignores canvas scrolling when deciding whether the anchored card fits', () => {
        const scrolled = keys.map(k => ({ ...k, top: k.top - 100, bottom: k.bottom - 100 }));
        const g = computeComboEditorGeometry(base({ placement: 'anchored', viewport: { width: 1440, height: 480 }, keys: scrolled, canvasScrollTop: 100 }));
        expect(g.reserve).toBeGreaterThan(0);
    });

    it('floats in the bottom-right corner when it is clear of the keys', () => {
        const g = computeComboEditorGeometry(base({ placement: 'float' }));
        expect(g.left).toBe(1440 - GAP - 430);
        expect(g.top).toBe(1000 - GAP - 100);
        expect(g.reserve).toBe(0);
    });

    it('lifts the float above canvas controls in its corner', () => {
        const controls = box(1040, 930, 390, 40);
        const g = computeComboEditorGeometry(base({ placement: 'float', obstacles: [controls, box(760, 920, 50, 50)] }));
        expect(overlaps(placed(g), controls)).toBe(false);
        expect(keys.some(k => overlaps(placed(g), k))).toBe(false);
        expect(g.top + 100).toBe(930 - GAP);
    });

    it('flips the float to another corner when keys fill the bottom-right', () => {
        const blocked = [...keys, box(1300, 900, 60, 60)];
        const g = computeComboEditorGeometry(base({ placement: 'float', keys: blocked }));
        expect(blocked.some(k => overlaps(placed(g), k))).toBe(false);
        expect(g.left).toBe(742);
    });

    it('reserves space instead of covering keys when no corner is clear', () => {
        const everywhere = [...keys, box(742, 90, 698, 30), box(742, 900, 698, 60)];
        const g = computeComboEditorGeometry(base({ placement: 'float', keys: everywhere }));
        expect(g.reserve).toBe(100 + 2 * GAP);
    });

    it('keeps a dragged float where the user put it, inside the column', () => {
        const g = computeComboEditorGeometry(base({ placement: 'float', manual: { x: 5000, y: -50 } }));
        expect(g.left).toBe(1440 - GAP - 430);
        expect(g.top).toBe(74 + GAP);
    });
});

describe('combo editor under a half', () => {
    // A split keyboard: left half 760..1000, right half 1180..1420, keys between y=180 and y=400.
    const left = [box(760, 180, 40, 40), box(860, 250, 40, 40), box(960, 360, 40, 40)];
    const right = [box(1180, 360, 40, 40), box(1280, 250, 40, 40), box(1380, 180, 40, 40)];
    const split = [...left, ...right];
    const half = (over: Partial<ComboEditorGeometryInput>) => base({ placement: 'half', keys: split, ...over });

    it('opens under the left half on a tie and never covers a key', () => {
        const g = computeComboEditorGeometry(half({ triggers: [left[0], right[0]] }));
        expect(g.spot).toBe('below-left');
        expect(g.left).toBe(760);
        expect(g.top).toBe(400 + GAP);
        expect(g.reserve).toBe(0);
        expect(split.some(k => overlaps(placed(g), k))).toBe(false);
    });

    it('opens under the half with fewer of the combo keys', () => {
        const g = computeComboEditorGeometry(half({ triggers: [left[0], left[1], right[0]] }));
        expect(g.spot).toBe('below-right');
        expect(g.left + 430).toBe(1420);
        expect(split.some(k => overlaps(placed(g), k))).toBe(false);
        expect(computeComboEditorGeometry(half({ triggers: [right[0], right[1], left[2]] })).spot).toBe('below-left');
        expect(computeComboEditorGeometry(half({ triggers: [] })).spot).toBe('below-left');
    });

    it('never covers a key at any default, in either layout, at 1280 and 1440 wide', () => {
        for (const width of [1280, 1440]) {
            for (const bottom of [false, true]) {
                const canvas = bottom ? box(64, 74, width - 64, 600) : box(742, 74, width - 742, 926);
                const panel = bottom ? box(56, 700, width - 56, 300) : box(64, 8, 512, 984);
                const shift = bottom ? -600 : 0;
                const ks = split.map(k => ({ ...k, left: k.left + shift + (width - 1440) / 2, right: k.right + shift + (width - 1440) / 2 }));
                for (const triggers of [[], [ks[0]], [ks[3]], [ks[0], ks[1], ks[4]]]) {
                    for (const height of [600, 1000]) {
                        const g = computeComboEditorGeometry(half({ viewport: { width, height }, canvas, panel, bottom, keys: ks, triggers }));
                        expect(ks.some(k => overlaps(placed(g), k))).toBe(false);
                    }
                }
            }
        }
    });

    it('sits at the bottom and reserves its height when there is no room under the keyboard', () => {
        const g = computeComboEditorGeometry(half({ viewport: { width: 1440, height: 480 }, triggers: [left[0]] }));
        expect(g.top).toBe(480 - GAP - 100);
        expect(g.reserve).toBe(100 + 2 * GAP);
        expect(g.spot).toBe('below-right');
    });

    it('prefers a spot clear of the canvas controls', () => {
        const controls = box(1250, 400 + GAP + 20, 180, 40);
        const g = computeComboEditorGeometry(half({ triggers: [left[0]], obstacles: [controls] }));
        expect(overlaps(placed(g), controls)).toBe(false);
        expect(g.spot).toBe('below-left');
    });

    it('follows a drag, then keeps the spot it snapped to', () => {
        const dragging = computeComboEditorGeometry(half({ manual: { x: 1000, y: 700 } }));
        expect(dragging.left).toBe(1000);
        expect(dragging.top).toBe(700);
        expect(dragging.spot).toBeUndefined();
        const snapped = nearestSpot(dragging.spots!, { left: 1000, top: 700 })!;
        expect(snapped.id).toBe('bottom-right');
        const g = computeComboEditorGeometry(half({ manualSpot: snapped.id }));
        expect(g.spot).toBe('bottom-right');
        expect(split.some(k => overlaps(placed(g), k))).toBe(false);
    });

    it('only offers spots that are clear of every key', () => {
        const g = computeComboEditorGeometry(half({ keys: [...split, box(742, 90, 698, 30)] }));
        for (const s of g.spots!) expect([...split, box(742, 90, 698, 30)].some(k => overlaps(box(s.left, s.top, 430, 100), k))).toBe(false);
        expect(g.spots!.some(s => s.id.startsWith('top-'))).toBe(false);
    });

    it('falls back to the default when the snapped spot is gone', () => {
        const g = computeComboEditorGeometry(half({ viewport: { width: 1440, height: 480 }, manualSpot: 'top-right' }));
        expect(g.spot).toBe('below-left');
    });
});
