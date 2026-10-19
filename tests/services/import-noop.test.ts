/**
 * Importing a backup of the board onto the same board writes nothing. Entries
 * read from the board and the same entries read back from a .svil differ in
 * field order, index fields and an `enabled` flag that some tables keep in
 * `options`; none of that is a change.
 */
import { describe, it, expect, vi } from 'vitest';
import { prepareImport } from '../../src/services/import-preflight';
import { ImportService, entryChanged } from '../../src/services/import.service';
import { fileService } from '../../src/services/file.service';
import type { KeyboardInfo } from '../../src/types/keyboard.types';
import { createKbinfoWithFragments, createFragmentState, FRAGMENT_IDS } from '../fixtures/fragments.fixture';

const N = 4;

/** A board as Keybard reads it: each table in its reader's shape. */
function board(): KeyboardInfo {
    const kb = createKbinfoWithFragments({
        layers: 2,
        fragmentState: createFragmentState({
            hwDetection: [[0, FRAGMENT_IDS.FINGER_5KEY], [1, FRAGMENT_IDS.FINGER_5KEY]],
            eepromSelections: [[0, 1]],
        }),
    });
    kb.kbid = 'a1b2c3d4e5f60718';
    kb.svil_proto = 3;
    kb.macros = [];
    kb.macro_count = 0;
    kb.macros_size = 256;
    kb.combo_count = kb.tapdance_count = kb.key_override_count = kb.alt_repeat_key_count = kb.leader_count = N;
    kb.combos = Array.from({ length: N }, (_, i) => ({ cmbid: i, keys: i ? ['KC_A', 'KC_B', 'KC_NO', 'KC_NO'] : ['KC_NO', 'KC_NO', 'KC_NO', 'KC_NO'], output: i ? 'KC_C' : 'KC_NO', options: i ? 0x8000 | 50 : 0 }));
    kb.tapdances = Array.from({ length: N }, (_, i) => ({ idx: i, tap: i ? 'KC_A' : 'KC_NO', hold: i ? 'KC_LSFT' : 'KC_NO', doubletap: 'KC_NO', taphold: 'KC_NO', tapping_term: 200, enabled: i > 0 }));
    kb.key_overrides = Array.from({ length: N }, (_, i) => ({ koid: i, trigger: i ? 'KC_BSPC' : 'KC_NO', replacement: i ? 'KC_DEL' : 'KC_NO', layers: 0xFFFF, trigger_mods: i ? 2 : 0, negative_mod_mask: 0, suppressed_mods: i ? 2 : 0, options: i ? 0x87 : 0 })) as any;
    kb.alt_repeat_keys = Array.from({ length: N }, (_, i) => ({ arkid: i, keycode: i ? 'KC_A' : 'KC_NO', alt_keycode: i ? 'KC_B' : 'KC_NO', allowed_mods: 0, options: i ? 0x08 : 0 }));
    kb.leaders = Array.from({ length: N }, (_, i) => ({ ldrid: i, sequence: i ? ['KC_A', 'KC_S'] : [], output: i ? 'KC_ESC' : 'KC_NO', options: i ? 0x8000 : 0 }));
    return kb;
}

const reload = (kb: KeyboardInfo) => fileService.svilToKBINFO(JSON.parse(fileService.kbinfoToSvil(kb)));

async function writeKeys(next: KeyboardInfo, current: KeyboardInfo) {
    const keys: string[] = [];
    const services = { keyboardService: { saveSvil: vi.fn(), updateFragmentSelection: vi.fn().mockResolvedValue(true) } };
    await new ImportService().syncWithKeyboard(next, current, async (_d, _cb, metadata) => { keys.push(metadata?.writeKey ?? ''); }, services);
    return keys;
}

describe('importing a backup of the same board', () => {
    it('queues no writes for any table or hardware position', async () => {
        const kb = board();
        const review = prepareImport(reload(kb), kb);
        expect(review.errors).toEqual([]);
        expect(await writeKeys(review.keyboard, kb)).toEqual([]);
    });

    it.each([
        ['combo:2', (kb: KeyboardInfo) => { kb.combos![2].output = 'KC_D'; }],
        ['tapdance:2', (kb: KeyboardInfo) => { kb.tapdances![2].tapping_term = 150; }],
        ['tapdance:3', (kb: KeyboardInfo) => { kb.tapdances![3].doubletap = 'KC_B'; }],
        ['override:2', (kb: KeyboardInfo) => { (kb.key_overrides as any)[2].options = 0x07; }],
        ['altrepeat:2', (kb: KeyboardInfo) => { kb.alt_repeat_keys![2].alt_keycode = 'KC_C'; }],
        ['leader:2', (kb: KeyboardInfo) => { kb.leaders![2].sequence = ['KC_A', 'KC_D']; }],
    ])('queues only %s when one entry differs', async (key, edit) => {
        const kb = board();
        const file = reload(kb);
        edit(file);
        const review = prepareImport(file, kb);
        expect(await writeKeys(review.keyboard, kb)).toEqual([key, 'save-svil']);
    });
});

describe('entryChanged', () => {
    it('ignores field order, index fields and keycode spelling', () => {
        expect(entryChanged('tapdances', { idx: 1, tap: 'KC_A', hold: 'KC_NO', doubletap: 'KC_NO', taphold: 'KC_NO', tapping_term: 200, enabled: true },
            { enabled: true, tapping_term: 200, taphold: 0, doubletap: 0, hold: 0, tap: 'KC_A' })).toBe(false);
        expect(entryChanged('key_overrides', { koid: 0, enabled: true, trigger: 'KC_A', replacement: 'KC_B', layers: 0xFFFF, trigger_mods: 0, negative_mod_mask: 0, suppressed_mods: 0, options: 0x80 },
            { trigger: 'KC_A', replacement: 'KC_B', layers: 0xFFFF, trigger_mods: 0, negative_mod_mask: 0, suppressed_mods: 0, options: 0x80 })).toBe(false);
        expect(entryChanged('combos', { keys: ['KC_A', 'KC_B'], output: 'KC_C', options: 0 }, { keys: ['KC_A', 'KC_B', 'KC_NO', 'KC_NO'], output: 'KC_C', options: 0 })).toBe(false);
    });

    it('sees a missing entry as a change', () => {
        expect(entryChanged('leaders', { sequence: [], output: 'KC_NO', options: 0 }, undefined)).toBe(true);
    });
});
