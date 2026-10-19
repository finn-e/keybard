/**
 * Keybard Host's overlay draws the keys where its profile puts them, and the
 * Host lays them out in Python (companion/overlay-host/keybard_host/device/geometry.py).
 * This test writes, from Keybard's own composer and editor math, the layouts
 * the Host must reproduce (companion/overlay-host/tests/fixtures/keybard-layouts.json),
 * and the Host's tests/test_keybard_layout.py checks its layouts against them.
 * Run with UPDATE_HOST_LAYOUTS=1 to rewrite the file after a layout change.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { FragmentComposerService } from '../../src/services/fragment-composer.service';
import { FragmentService } from '../../src/services/fragment.service';
import { KleService } from '../../src/services/kle.service';
import { editorKeyRects, editorKeyLayout, editorYPos } from '../../src/utils/editor-key-layout';
import { geometry } from '../../src/features/trainer/core';
import { SVALBOARD_LAYOUT } from '../../src/constants/svalboard-layout';
import { fileService } from '../../src/services/file.service';
import { placeDevice } from '../../src/utils/pointing-geometry';
import type { KeyboardInfo } from '../../src/types/keyboard.types';
import { createFragmentState } from '../fixtures/fragments.fixture';
import { createTestKeyboardInfo } from '../fixtures/keyboard-info.fixture';

const definition = JSON.parse(readFileSync(resolve(__dirname, '../fixtures/firmware/sval.json'), 'utf8'));
const goldenPath = resolve(__dirname, '../../companion/overlay-host/tests/fixtures/keybard-layouts.json');
const instances: { id: string; fragment?: string; fragment_options?: { fragment: string }[] }[] = definition.composition.instances;
const FINGERS = ['left_pinky', 'left_ring', 'left_middle', 'left_index', 'right_index', 'right_middle', 'right_ring', 'right_pinky'];

/** Each case names a fragment per instance; anything unnamed takes its default. */
const CASES: Record<string, Record<string, string>> = {
    'six-key fingers': Object.fromEntries(FINGERS.map(id => [id, 'finger_6'])),
    'five-key fingers': Object.fromEntries(FINGERS.map(id => [id, 'finger_5'])),
    'five-key left, six-key right': Object.fromEntries(FINGERS.map(id => [id, id.startsWith('left') ? 'finger_5' : 'finger_6'])),
    'six-key left index only': { ...Object.fromEntries(FINGERS.map(id => [id, 'finger_5'])), left_index: 'finger_6' },
    'finger cluster as left thumb': { ...Object.fromEntries(FINGERS.map(id => [id, 'finger_5'])), left_thumb: 'finger_5' },
};

const composer = new FragmentComposerService(new KleService(), new FragmentService());
type Rect = [number, number, number, number];
const rects = (layout: Record<number, { x: number; y: number; w: number; h: number }>) =>
    Object.fromEntries(Object.entries(layout).map(([pos, k]) => [pos, [k.x, k.y, k.w, k.h] as Rect]));

function boardFor(choice: Record<string, string>): KeyboardInfo {
    const kb = createTestKeyboardInfo({ rows: 10, cols: 6, layers: 2, kbid: '5a5a5a5a5a5a5a5a' });
    kb.fragments = definition.fragments;
    kb.composition = definition.composition;
    kb.fragmentState = createFragmentState({ userSelections: Object.entries(choice) as [string, string][] });
    kb.keylayout = composer.composeLayout(kb);
    return kb;
}

function expected() {
    return {
        note: 'Written by Keybard tests/trainer/host-overlay-layout.test.ts: key rects [x, y, w, h] as the Keybard editor draws them.',
        definition: { fragments: definition.fragments, composition: definition.composition },
        cases: Object.entries(CASES).map(([name, choice]) => ({
            name,
            // The option index per instance, as the board's 0x19 selections store it; 255 for none.
            selections: instances.map(i => {
                const index = (i.fragment_options ?? []).findIndex(o => o.fragment === choice[i.id]);
                return index < 0 ? 255 : index;
            }),
            layout: rects(editorKeyRects(boardFor(choice))),
        })),
        // What the editor draws for the bundled default layout (the QWERTY Example): the Host's layout without a board definition.
        bundledDefault: rects(editorKeyRects(fileService.parseContent(readFileSync(resolve(__dirname, '../../src/default-layouts/sval-default.svil'), 'utf8')))),
    };
}

describe('Keybard Host overlay layout', () => {
    it('the Host fixture holds the layouts Keybard draws', () => {
        const want = expected();
        if (process.env.UPDATE_HOST_LAYOUTS || !existsSync(goldenPath)) writeFileSync(goldenPath, JSON.stringify(want, null, 1) + '\n');
        expect(JSON.parse(readFileSync(goldenPath, 'utf8'))).toEqual(want);
    });

    it('the editor draws a composed layout as composed, and the schematic with its bottom thumb row lower', () => {
        const kb = boardFor(CASES['six-key fingers']);
        expect(editorKeyLayout(kb)).toEqual({ layout: kb.keylayout, fragment: true });
        expect(editorKeyLayout({})).toEqual({ layout: SVALBOARD_LAYOUT, fragment: false });
        expect(editorYPos(6, false)).toBeCloseTo(6.3);
        expect(editorYPos(6, true)).toBe(6);
        expect(editorKeyRects({})[0].y).toBeCloseTo(6.3);
        expect(editorKeyRects({})[1].y).toBe(5);
    });

    it('the trainer surface uses the editor positions', () => {
        for (const kb of [boardFor(CASES['five-key fingers']), { ...boardFor(CASES['six-key fingers']), keylayout: undefined }]) {
            const drawn = editorKeyRects(kb);
            const keys = geometry(kb);
            expect(keys.length).toBe(Object.keys(drawn).length);
            for (const k of keys) {
                const d = drawn[k.id];
                expect([k.x, k.y, k.w, k.h]).toEqual([d.x, d.y, d.w, d.h]);
            }
        }
    });

    it('the pointing devices sit where the editor puts them, beside the overlay keys', () => {
        const golden = JSON.parse(readFileSync(goldenPath, 'utf8'));
        for (const c of golden.cases.slice(0, 2)) {
            // The overlay draws the Host's rects from their top-left corner; the editor from its own origin.
            const host = Object.values(c.layout as Record<string, Rect>).map(([x, y, w, h]) => ({ x, y, w, h }));
            const minX = Math.min(...host.map(k => k.x)), minY = Math.min(...host.map(k => k.y));
            const rel = host.map(k => ({ ...k, x: k.x - minX, y: k.y - minY }));
            const editor = Object.values(editorKeyRects(boardFor(CASES[c.name])));
            for (const side of ['left', 'right'] as const) for (const kind of ['ball', 'pad'] as const) {
                const overlay = placeDevice(rel, side, kind), drawn = placeDevice(editor, side, kind);
                expect(overlay).not.toBeNull();
                expect({ ...overlay!, cx: overlay!.cx + minX, cy: overlay!.cy + minY }).toEqual(drawn);
            }
        }
    });

    it('middle and ring clusters sit 1.5u above index and pinky, as on the board', () => {
        const kb = boardFor(CASES['five-key fingers']);
        const center = (row: number) => kb.keylayout![row * 6 + 2].y;
        for (const [outer, inner] of [[1, 2], [4, 3], [6, 7], [9, 8]]) expect(center(outer) - center(inner)).toBe(1.5);
    });
});
