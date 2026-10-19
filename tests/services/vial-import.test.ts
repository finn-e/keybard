import { describe, expect, it } from 'vitest';
import { fileService } from '../../src/services/file.service';
import { prepareImport } from '../../src/services/import-preflight';
import { keyService } from '../../src/services/key.service';
import { ComboOptions, type KeyboardInfo } from '../../src/types/keyboard.types';

// Moving from Svalboard's Vial firmware goes through its .vil files, which store
// keycodes by name. Custom keys are the exception: Vial names them by position.

const SVALBOARD_VIAL_UID = '5199957870438586395';

function vil(uid: string, overrides: Record<string, unknown> = {}): string {
    const blank = () => [Array(2).fill('KC_NO')];
    const body = JSON.stringify({
        version: 1, vial_protocol: 6, via_protocol: 9, layout_options: -1,
        uid: '__UID__',
        layout: [[['KC_A', 'USER03']], [['QK_STENO_BOLT', 'USER25']]],
        tap_dance: [['KC_A', 'USER00', 'KC_NO', 'KC_NO', 180], ['KC_NO', 'KC_NO', 'KC_NO', 'KC_NO', 200]],
        combo: [['KC_A', 'KC_B', 'KC_NO', 'KC_NO', 'USER08'], ['KC_NO', 'KC_NO', 'KC_NO', 'KC_NO', 'KC_NO']],
        key_override: [{ trigger: 'KC_BSPC', replacement: 'KC_DEL', layers: 65535, trigger_mods: 2, negative_mod_mask: 0, suppressed_mods: 2, options: 135 }],
        macro: [[['text', 'hi'], ['tap', 'USER17', 'KC_ENTER'], ['delay', 50]], []],
        encoder_layout: blank(),
        settings: { '2': 50, '7': 190, '21': 3 },
        ...overrides,
    });
    return body.replace('"__UID__"', uid);
}

const board = {
    rows: 1, cols: 2, layers: 2, keymap: [[0, 0], [0, 0]], svil_proto: 3, keycode_version: '0.0.9',
    kbid: '4829f621f27d181b', macro_count: 256, combo_count: 256, tapdance_count: 256, key_override_count: 256,
    macros_size: 4096, macros: [], combos: [], tapdances: [], key_overrides: [],
    settings: { 2: 30, 7: 200, 21: 0 },
} as unknown as KeyboardInfo;

describe('importing a Svalboard Vial layout', () => {
    it('names custom keys by what they were in Vial', () => {
        const kb = fileService.parseContent(vil(SVALBOARD_VIAL_UID));
        expect(keyService.stringify(kb.keymap![0][1])).toBe('SV_RIGHT_DPI_DEC');
        expect(kb.keymap![0][1]).toBe(0x7E43); // QK_USER_3 on Svalboard QMK
        expect(kb.tapdances![0]).toMatchObject({ tap: 'KC_A', hold: 'SV_LEFT_DPI_INC', tapping_term: 180, enabled: true });
        expect(kb.combos![0]).toMatchObject({ keys: ['KC_A', 'KC_B', 'KC_NO', 'KC_NO'], output: 'SV_CAPS_WORD' });
        expect(kb.macros![0].actions).toEqual([['text', 'hi'], ['tap', 'SV_OUTPUT_STATUS'], ['tap', 'KC_ENTER'], ['delay', 50]]);
    });

    it('turns on every tap dance, and only the combos that are used', () => {
        const kb = fileService.parseContent(vil(SVALBOARD_VIAL_UID));
        expect(kb.tapdances!.map(td => td.enabled)).toEqual([true, true]);
        expect(kb.combos!.map(combo => combo.options)).toEqual([ComboOptions.ENABLED, 0]);
        expect(kb.key_overrides![0]).toMatchObject({ trigger: 'KC_BSPC', replacement: 'KC_DEL', options: 135 });
    });

    it('numbers renamed keycodes the way the board does', () => {
        const kb = fileService.parseContent(vil(SVALBOARD_VIAL_UID));
        expect(kb.keymap![1][0]).toBe(0x751C); // QK_STENO_MODE_BOLT in QMK 0.0.9
    });

    it('clears custom keys Vial left unassigned, and says so', () => {
        const kb = fileService.parseContent(vil(SVALBOARD_VIAL_UID));
        expect(kb.keymap![1][1]).toBe(0);
        const review = prepareImport(kb, board);
        expect(review.errors).toEqual([]);
        expect(review.warnings.join(' ')).toMatch(/1 key uses a custom keycode that Svalboard's Vial firmware left unassigned/);
        expect(review.warnings.join(' ')).toMatch(/do not include pointing and hardware settings/);
    });

    it('applies the layout, behaviors and QMK settings', () => {
        const review = prepareImport(fileService.parseContent(vil(SVALBOARD_VIAL_UID)), board);
        expect(review.keyboard.keymap![0]).toEqual([0x0004, 0x7E43]);
        expect(review.keyboard.settings).toEqual({ 2: 50, 7: 190, 21: 3 });
        expect(review.keyboard.combos![0].output).toBe('SV_CAPS_WORD');
    });

    it('recognizes Svalboard files whose UID a tool rounded', () => {
        const kb = fileService.parseContent(vil('5199957870438586000'));
        expect(kb.vial_import?.svalboard).toBe(true);
        expect(kb.kbid).toBe('4829f621f27d181b');
        expect(prepareImport(kb, board).warnings.join(' ')).not.toMatch(/different keyboard/);
    });

    it("refuses another keyboard's custom keys rather than guessing", () => {
        const kb = fileService.parseContent(vil('1234567890123456789', { layout: [[['KC_A', 'USER03']], [['KC_B', 'KC_C']]] }));
        expect(kb.vial_import?.svalboard).toBe(false);
        expect(prepareImport(kb, board).errors.join(' ')).toMatch(/custom keys? \(USER00…\) from another keyboard/);
    });
});
