/**
 * The board definition the Svalboard firmware embeds (keymaps/sval/sval.json on
 * feat/pointing-fragments, copied to tests/fixtures/firmware/sval.json) composes
 * into a layout with one pointing slot per hand, each sitting in the open space
 * between that hand's finger clusters and thumb cluster without covering a key.
 *
 * Set SVAL_FIRMWARE_JSON to a firmware checkout's sval.json to run against it
 * instead of the copy.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

import { FragmentComposerService } from '../../src/services/fragment-composer.service';
import { FragmentService } from '../../src/services/fragment.service';
import { KleService } from '../../src/services/kle.service';
import type { KeyboardInfo } from '../../src/types/keyboard.types';
import { createFragmentState } from '../fixtures/fragments.fixture';
import { createTestKeyboardInfo } from '../fixtures/keyboard-info.fixture';

const override = process.env.SVAL_FIRMWARE_JSON;
const jsonPath = override && existsSync(override) ? override : resolvePath(__dirname, '../fixtures/firmware/sval.json');
const definition = JSON.parse(readFileSync(jsonPath, 'utf8'));

const FINGERS = ['left_pinky', 'left_ring', 'left_middle', 'left_index', 'right_index', 'right_middle', 'right_ring', 'right_pinky'];
// Matrix rows per cluster in the Svalboard matrix.
const LEFT_FINGER_ROWS = [1, 2, 3, 4];
const RIGHT_FINGER_ROWS = [6, 7, 8, 9];
const LEFT_THUMB_ROW = 0;
const RIGHT_THUMB_ROW = 5;

function kbinfoFor(finger: 'finger_5' | 'finger_6', hw: [number, number][] = []): KeyboardInfo {
    const kb = createTestKeyboardInfo({ rows: definition.matrix.rows, cols: definition.matrix.cols, layers: 2, kbid: '5a5a5a5a5a5a5a5a' });
    kb.fragments = definition.fragments;
    kb.composition = definition.composition;
    kb.fragmentState = createFragmentState({
        hwDetection: hw,
        userSelections: FINGERS.map((id) => [id, finger] as [string, string]),
    });
    return kb;
}

const composer = () => new FragmentComposerService(new KleService(), new FragmentService(null as any));
type Box = { x: number; y: number; w: number; h: number };
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const bounds = (boxes: Box[]) => {
    const x0 = Math.min(...boxes.map((b) => b.x));
    const y0 = Math.min(...boxes.map((b) => b.y));
    const x1 = Math.max(...boxes.map((b) => b.x + b.w));
    const y1 = Math.max(...boxes.map((b) => b.y + b.h));
    return { x0, y0, x1, y1 };
};

describe('firmware board definition: pointing slots', () => {
    it('declares the two hardware-detected pointing instances and six zero-key widget fragments', () => {
        const ids = definition.composition.instances.map((i: any) => i.id);
        expect(ids).toContain('left_pointing');
        expect(ids).toContain('right_pointing');
        const widgets = Object.entries(definition.fragments).filter(([, f]: any) => f.widget);
        expect(widgets.map(([n]) => n).sort()).toEqual([
            'pointing_none', 'pointing_touchpad_azoteq', 'pointing_trackball_pmw3360',
            'pointing_trackball_pmw3389', 'pointing_trackpoint', 'pointing_unknown',
        ]);
        for (const [, f] of widgets as [string, any][]) expect(f.kle).toEqual([]);
    });

    for (const finger of ['finger_5', 'finger_6'] as const) {
        it(`puts each slot in its hand's open space without covering a key (${finger})`, () => {
            const kb = kbinfoFor(finger);
            const keys = Object.values(composer().composeLayout(kb));
            expect(keys.length).toBe(finger === 'finger_6' ? 60 : 52);

            const slots = composer().composeWidgets(kb, new Map());
            expect(slots.map((s) => s.side).sort()).toEqual(['left', 'right']);

            for (const s of slots) {
                for (const k of keys) {
                    expect(overlaps(s, k), `${s.side} slot overlaps key r${k.row}c${k.col}`).toBe(false);
                }
                const left = s.side === 'left';
                const fingerKeys = keys.filter((k) => (left ? LEFT_FINGER_ROWS : RIGHT_FINGER_ROWS).includes(k.row));
                const thumbKeys = keys.filter((k) => k.row === (left ? LEFT_THUMB_ROW : RIGHT_THUMB_ROW));
                const f = bounds(fingerKeys);
                const t = bounds(thumbKeys);

                // Below the tops of the finger clusters, above the bottom of the thumb cluster.
                expect(s.y).toBeGreaterThan(f.y0);
                // Horizontally within the hand: inside the finger clusters' span, and
                // outboard of the thumb's top row (Enter on the left, Space on the right).
                expect(s.x).toBeGreaterThanOrEqual(f.x0);
                expect(s.x + s.w).toBeLessThanOrEqual(f.x1);
                const topRow = thumbKeys.filter((k) => k.y - t.y0 < 0.25);
                if (left) expect(s.x + s.w).toBeLessThanOrEqual(Math.min(...topRow.map((k) => k.x)) + 0.01);
                else expect(s.x).toBeGreaterThanOrEqual(Math.max(...topRow.map((k) => k.x + k.w)) - 0.01);
                // Beside the thumb, as on the board: it reaches below the thumb's top.
                expect(s.y + s.h).toBeGreaterThan(t.y0);

                // Every finger cluster above the slot's top edge or beside it: the slot
                // is surrounded, not hanging off the bottom of the hand.
                const below = fingerKeys.filter((k) => k.y >= s.y + s.h);
                expect(below, `${s.side} slot sits above finger keys`).toEqual([]);
            }

            // Mirror images about the board's midline.
            const [l, r] = [slots.find((s) => s.side === 'left')!, slots.find((s) => s.side === 'right')!];
            const all = bounds(keys);
            const mid = (all.x0 + all.x1) / 2;
            expect(mid - (l.x + l.w / 2)).toBeCloseTo(r.x + r.w / 2 - mid, 5);
            expect(l.y).toBeCloseTo(r.y, 5);
        });
    }

    it('renders the detected module on each hand', () => {
        const idx = (id: string) => definition.composition.instances.findIndex((i: any) => i.id === id);
        const fid = (name: string) => definition.fragments[name].id;
        const kb = kbinfoFor('finger_6');
        const slots = composer().composeWidgets(kb, new Map([
            [idx('left_pointing'), fid('pointing_trackball_pmw3360')],
            [idx('right_pointing'), fid('pointing_touchpad_azoteq')],
        ]));
        expect(slots.find((s) => s.side === 'left')!.widget).toMatchObject({ module: 'trackball', sensor: 'pmw3360' });
        expect(slots.find((s) => s.side === 'right')!.widget).toMatchObject({ module: 'touchpad', sensor: 'azoteq' });
    });
});
