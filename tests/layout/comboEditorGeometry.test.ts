import { describe, expect, it } from 'vitest';
import { computeComboEditorGeometry, COMBO_EDITOR_GAP as GAP, type Box, type ComboEditorGeometryInput } from '@/layout/SecondarySidebar/comboEditorGeometry';

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
