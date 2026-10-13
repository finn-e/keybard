import { describe, it, expect } from 'vitest';

import { FragmentComposerService, isWidgetInstance, POINTING_POCKET_MARGIN, POINTING_SPAN_SHARE, widgetInstanceIndices } from '../../src/services/fragment-composer.service';
import { FragmentService } from '../../src/services/fragment.service';
import { KleService } from '../../src/services/kle.service';
import { fileService } from '../../src/services/file.service';
import {
    createPointingInstance,
    createSvalboardPointingKbinfo,
    POINTING_FRAGMENT_IDS as ID,
    POINTING_INSTANCE_IDX as IDX,
} from '../fixtures/fragments.fixture';

const composer = () => new FragmentComposerService(new KleService(), new FragmentService(null as any));

describe('widget fragments (pointing slots)', () => {
    it('recognizes widget instances and only those', () => {
        const kb = createSvalboardPointingKbinfo();
        expect([...widgetInstanceIndices(kb)]).toEqual([IDX.left, IDX.right]);
        expect(isWidgetInstance(kb, kb.composition!.instances[0])).toBe(false);
        expect(isWidgetInstance(kb, createPointingInstance('left'))).toBe(true);
        // A mixed instance (one key option) is not a widget instance.
        const mixed = { ...createPointingInstance('left'), fragment_options: [...createPointingInstance('left').fragment_options!, { fragment: 'finger_5', placement: { x: 0, y: 0 }, matrix_map: [] as [number, number][] }] };
        expect(isWidgetInstance(kb, mixed)).toBe(false);
        expect(isWidgetInstance({ fragments: undefined }, createPointingInstance('left'))).toBe(false);
    });

    it('adds no keys to the layout: composeLayout is unchanged by the pointing instances', () => {
        const withPointing = composer().composeLayout(createSvalboardPointingKbinfo());
        const without = composer().composeLayout(createSvalboardPointingKbinfo({ withPointing: false }));
        expect(Object.keys(withPointing).length).toBeGreaterThan(0);
        expect(withPointing).toEqual(without);
    });

    it('puts a square under the ring and middle clusters, centred on the gap between X and C, as big as the keys allow', () => {
        for (const sixKey of [false, true]) {
            const kb = createSvalboardPointingKbinfo({ sixKey });
            const keys = Object.values(composer().composeLayout(kb));
            const byRow = (rows: number[]) => keys.filter((k) => rows.includes(k.row));
            const slots = composer().composeWidgets(kb, new Map());
            for (const s of slots) {
                const left = s.side === 'left';
                const [ringRow, middleRow] = left ? [3, 2] : [8, 7];
                const bottom = (row: number) => byRow([row]).reduce((a, k) => (k.y + k.h > a.y + a.h ? k : a));
                const ring = bottom(ringRow), middle = bottom(middleRow);
                const [outer, inner] = left ? [ring, middle] : [middle, ring];
                expect(s.w).toBeCloseTo(s.h, 9);
                expect(s.x + s.w / 2).toBeCloseTo((outer.x + outer.w + inner.x) / 2, 9);
                expect(s.y).toBeCloseTo(Math.max(ring.y + ring.h, middle.y + middle.h) + POINTING_POCKET_MARGIN, 9);
                const fingers = keys.filter((k) => (left ? [1, 2, 3, 4] : [6, 7, 8, 9]).includes(k.row));
                const span = Math.max(...fingers.map((k) => k.x + k.w)) - Math.min(...fingers.map((k) => k.x));
                expect(s.w).toBeLessThanOrEqual(POINTING_SPAN_SHARE * span + 1e-9);
                expect(s.w).toBeGreaterThan(3); // much bigger than the gap between X and C
                // As big as it can be: a little bigger would reach a key's margin.
                const g = s.w + 0.05, gx = s.x + s.w / 2 - g / 2;
                const blocked = keys.some((k) => k.x < gx + g + POINTING_POCKET_MARGIN && gx - POINTING_POCKET_MARGIN < k.x + k.w && k.y < s.y + g + POINTING_POCKET_MARGIN && s.y - POINTING_POCKET_MARGIN < k.y + k.h);
                expect(blocked || s.w >= POINTING_SPAN_SHARE * span - 1e-6).toBe(true);
            }
            const [l, r] = [slots.find((s) => s.side === 'left')!, slots.find((s) => s.side === 'right')!];
            expect((l.x + l.w / 2 + r.x + r.w / 2) / 2).toBeCloseTo(12.5, 5);
            expect(l.y).toBeCloseTo(r.y, 9);
            expect(l.w).toBeCloseTo(r.w, 9);
        }
    });

    it('keeps the slots clear of every key, with 5- and 6-key fingers', () => {
        for (const sixKey of [false, true]) {
            const kb = createSvalboardPointingKbinfo({ sixKey });
            const keys = Object.values(composer().composeLayout(kb));
            const slots = composer().composeWidgets(kb, new Map());
            for (const s of slots) {
                for (const k of keys) {
                    const overlaps = k.x < s.x + s.w && s.x < k.x + k.w && k.y < s.y + s.h && s.y < k.y + k.h;
                    expect(overlaps, `${s.side} slot overlaps key r${k.row}c${k.col} (${sixKey ? 6 : 5}-key)`).toBe(false);
                }
            }
        }
    });

    it('takes the fragment only from hardware detection', () => {
        const kb = createSvalboardPointingKbinfo();
        // EEPROM and user selections for the widget instances are ignored.
        kb.fragmentState!.eepromSelections.set(IDX.left, 1);
        kb.fragmentState!.userSelections.set('left_pointing', 'pointing_trackpoint');
        const hw = new Map([[IDX.left, ID.pointing_trackball_pmw3389], [IDX.right, 0xff]]);
        const [left, right] = composer().composeWidgets(kb, hw);
        expect(left).toMatchObject({ instanceIdx: IDX.left, instanceId: 'left_pointing', side: 'left', fragmentName: 'pointing_trackball_pmw3389' });
        expect(left.widget).toMatchObject({ module: 'trackball', sensor: 'pmw3389' });
        expect(right).toMatchObject({ side: 'right', fragmentName: null, widget: null });
    });

    it('treats a detected id that is not one of the options as unsettled', () => {
        const kb = createSvalboardPointingKbinfo();
        const [left] = composer().composeWidgets(kb, new Map([[IDX.left, 0 /* finger_5 */]]));
        expect(left.widget).toBeNull();
    });

    it('returns nothing for definitions without widget instances', () => {
        expect(composer().composeWidgets(createSvalboardPointingKbinfo({ withPointing: false }), new Map())).toEqual([]);
    });
});

describe('fragment plumbing guards', () => {
    it('widget instances are not selectable (Fragments panel, Apply default, import preflight)', () => {
        const kb = createSvalboardPointingKbinfo();
        const ids = new FragmentService(null as any).getSelectableInstances(kb).map(({ instance }) => instance.id);
        expect(ids).toHaveLength(10);
        expect(ids).not.toContain('left_pointing');
        expect(ids).not.toContain('right_pointing');
    });

    it('ignores 0x19 selection bytes for widget instances', async () => {
        const kb = createSvalboardPointingKbinfo();
        const reply = new Uint8Array(23).fill(0xff);
        reply[0] = 0x19;
        reply[1] = 12;
        reply[2] = 1; // left_pinky: finger_6
        reply[2 + IDX.left] = 3;
        reply[2 + IDX.right] = 0;
        const usb = { sendSvil: async (cmd: number) => (cmd === 0x19 ? reply : new Uint8Array([0x18, 12, ...new Array(21).fill(0xff)])) };
        await new FragmentService(usb as any).get(kb);
        expect([...kb.fragmentState!.eepromSelections.entries()]).toEqual([[0, 1]]);
    });

    it('readHardwareDetection returns detected ids without touching keyboard state', async () => {
        const reply = new Uint8Array(23).fill(0xff);
        reply[0] = 0x18;
        reply[1] = 12;
        reply[2 + IDX.left] = ID.pointing_trackpoint;
        const svc = new FragmentService({ sendSvil: async () => reply } as any);
        expect([...(await svc.readHardwareDetection())!.entries()]).toEqual([[IDX.left, ID.pointing_trackpoint]]);
        expect(await new FragmentService({ sendSvil: async () => { throw new Error('gone'); } } as any).readHardwareDetection()).toBeNull();
    });

    it('.svil export records no selection for widget instances, and import composes the same keys', () => {
        const kb = createSvalboardPointingKbinfo({ hwDetection: [[IDX.left, ID.pointing_trackpoint]] });
        kb.keymap = [new Array(60).fill(0), new Array(60).fill(0)] as any;
        const svil = JSON.parse(fileService.kbinfoToSvil(kb));
        expect(Object.keys(svil.fragment_selections)).toHaveLength(10);
        expect(svil.fragment_selections.left_pointing).toBeUndefined();
        expect(svil.composition.instances.map((i: { id: string }) => i.id)).toContain('right_pointing');

        // A file that does carry a pointing selection (older export) adds no keys.
        svil.fragment_selections.left_pointing = 'pointing_trackpoint';
        const back = fileService.svilToKBINFO(svil);
        expect(back.keylayout).toEqual(composer().composeLayout(createSvalboardPointingKbinfo()));
    });
});
