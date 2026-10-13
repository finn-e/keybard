import { describe, it, expect } from 'vitest';

import { FragmentComposerService, isWidgetInstance, POINTING_POCKET_MARGIN, widgetInstanceIndices } from '../../src/services/fragment-composer.service';
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

    it('fits each slot to the pocket from X to Enter and from X and C down to the thumb, mirrored about 12.5', () => {
        for (const sixKey of [false, true]) {
            const kb = createSvalboardPointingKbinfo({ sixKey });
            const keys = Object.values(composer().composeLayout(kb));
            const slots = composer().composeWidgets(kb, new Map());
            const left = slots.find((s) => s.side === 'left')!;
            const right = slots.find((s) => s.side === 'right')!;
            for (const s of [left, right]) {
                expect(s.w).toBeGreaterThan(s.h); // wider than tall: X to Enter is longer than X to the thumb
                expect(s.h).toBeGreaterThan(1.5);
                // Keys directly above end at least a margin above it; the thumb starts at least a margin below.
                const above = keys.filter((k) => k.x < s.x + s.w && s.x < k.x + k.w && k.y + k.h <= s.y + 1e-6);
                const below = keys.filter((k) => k.x < s.x + s.w + 1 && s.x - 1 < k.x + k.w && k.y >= s.y + s.h - 1e-6);
                expect(above.length, `${s.side} has finger keys above (${sixKey ? 6 : 5}-key)`).toBeGreaterThan(0);
                expect(s.y - Math.max(...above.map((k) => k.y + k.h))).toBeGreaterThanOrEqual(POINTING_POCKET_MARGIN - 1e-6);
                expect(below.length, `${s.side} has thumb keys below`).toBeGreaterThan(0);
                expect(Math.min(...below.map((k) => k.y)) - (s.y + s.h)).toBeGreaterThanOrEqual(POINTING_POCKET_MARGIN - 1e-6);
            }
            expect((left.x + left.w / 2 + right.x + right.w / 2) / 2).toBeCloseTo(12.5, 5);
            expect(left.y).toBeCloseTo(right.y, 5);
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
