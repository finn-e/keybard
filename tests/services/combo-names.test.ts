// Combo names: Keybard-only names in cosmetic.combos. The .svil round trip, the
// import preflight and sync, connect-time seeding from a backup, and stale-name
// suppression.
import { describe, expect, it, vi } from 'vitest';
import { fileService } from '../../src/services/file.service';
import { prepareImport } from '../../src/services/import-preflight';
import { ImportService } from '../../src/services/import.service';
import { usbInstance } from '../../src/services/usb.service';
import { validateLabelText } from '../../src/services/label.service';
import { summarizeSvilChange } from '../../src/services/backup/diff-summary';
import { ComboOptions, type ComboEntry, type KeyboardInfo } from '../../src/types/keyboard.types';
import { comboName, comboNamesFromSvil, sameCombo, seedComboNames } from '../../src/utils/combo-names';
import { comboSentence, keyComboAriaLabel } from '../../src/utils/combo-labels';
import { bindingEditorHeading, bindingEditorSubtitle, bindingEditorTitle } from '../../src/lib/bindingSpotlight';
import { createTestKeyboardInfo } from '../fixtures/keyboard-info.fixture';

const ON = ComboOptions.ENABLED;
const combo = (keys: string[], output: string, options = ON): ComboEntry => ({ cmbid: 0, keys: [...keys, 'KC_NO', 'KC_NO', 'KC_NO', 'KC_NO'].slice(0, 4), output, options });

const board = (overrides: Partial<KeyboardInfo> = {}): KeyboardInfo => ({
    rows: 1, cols: 2, layers: 1, keymap: [[4, 5]], svil_proto: 3,
    macros: [], macro_count: 0, macros_size: 64,
    combos: [combo(['KC_J', 'KC_K'], 'KC_ESC'), combo(['KC_D', 'KC_F'], 'KC_ENTER'), combo([], 'KC_NO', 0)],
    combo_count: 3, tapdances: [], tapdance_count: 0, key_overrides: [], key_override_count: 0,
    cosmetic: {},
    ...overrides,
});

describe('combo name helpers', () => {
    it('reads a trimmed name and treats blank as none', () => {
        expect(comboName({ combos: { '2': ' Dictation ' } }, 2)).toBe('Dictation');
        expect(comboName({ combos: { '2': '  ' } }, 2)).toBeUndefined();
        expect(comboName(undefined, 0)).toBeUndefined();
    });

    it('compares what a combo does, not how its keycodes are spelled', () => {
        expect(sameCombo(combo(['KC_ENT'], 'KC_ESC'), combo(['KC_ENTER'], 'KC_ESCAPE'))).toBe(true);
        expect(sameCombo(combo(['KC_J', 'KC_K'], 'KC_ESC'), combo(['KC_J', 'KC_L'], 'KC_ESC'))).toBe(false);
        expect(sameCombo(combo(['KC_J'], 'KC_ESC'), combo(['KC_J'], 'KC_TAB'))).toBe(false);
        expect(sameCombo(combo(['KC_J'], 'KC_ESC', ON), combo(['KC_J'], 'KC_ESC', 0))).toBe(false);
        // The combo term is timing, not what the combo does.
        expect(sameCombo(combo(['KC_J'], 'KC_ESC', ON | 30), combo(['KC_J'], 'KC_ESC', ON | 50))).toBe(true);
        expect(sameCombo(undefined, undefined)).toBe(false);
    });

    it('validates with the board label rules but without the firmware gate', () => {
        expect(() => validateLabelText('Dictation')).not.toThrow();
        expect(() => validateLabelText('x'.repeat(16))).not.toThrow();
        expect(() => validateLabelText('x'.repeat(17))).toThrow(/16 UTF-8 bytes/);
        expect(() => validateLabelText('ééééééééé')).toThrow(/16 UTF-8 bytes/);
        expect(() => validateLabelText('a\tb')).toThrow(/control characters/);
    });

    it('puts the name in the screen reader sentence', () => {
        const m = { index: 3, enabled: true, inputs: ['KC_J', 'KC_K'], output: 'KC_ESC' };
        expect(comboSentence(m)).toBe('Combo 3: J plus K gives Esc');
        expect(comboSentence(m, 'Dictation')).toBe('Dictation (Combo 3): J plus K gives Esc');
        expect(comboSentence({ ...m, enabled: false }, 'Dictation')).toBe('Dictation (Combo 3), off: J plus K gives Esc');
        expect(keyComboAriaLabel('J', [m], { '3': 'Dictation' })).toBe('J: in 1 combo. Dictation (Combo 3): J plus K gives Esc');
    });

    it('names the editor: "Editing Combo N" with the name under it, the card title the name', () => {
        const cosmetic = { combos: { '1': 'Zoom mute' } };
        expect(bindingEditorHeading('combos', 1)).toBe('Editing Combo 1');
        expect(bindingEditorSubtitle('combos', 1, cosmetic)).toBe('Zoom mute');
        expect(bindingEditorSubtitle('combos', 0, cosmetic)).toBeNull();
        expect(bindingEditorTitle('combos', 1, cosmetic)).toBe('Zoom mute');
        expect(bindingEditorTitle('combos', 0, cosmetic)).toBe('Combo 0');
    });
});

describe('.svil round trip', () => {
    it('writes combo names and reads them back', () => {
        const kb = createTestKeyboardInfo({
            kbid: '1234567890ABCDEF', rows: 2, cols: 2, layers: 1, keymap: [Array(4).fill(0x04)],
            combos: [combo(['KC_J', 'KC_K'], 'KC_ESC')], combo_count: 1,
            cosmetic: { combos: { '0': 'Dictation' } },
        });
        const svil = fileService.kbinfoToSvil(structuredClone(kb), true);
        expect(JSON.parse(svil).cosmetic.combos).toEqual({ '0': 'Dictation' });
        const back = fileService.parseContent(svil);
        expect(back.cosmetic?.combos).toEqual({ '0': 'Dictation' });
        expect(comboNamesFromSvil(svil)?.cosmetic?.combos).toEqual({ '0': 'Dictation' });
    });

    it('reports a renamed combo as a names change in the backup summary', () => {
        const kb = createTestKeyboardInfo({ kbid: '1234567890ABCDEF', combos: [combo(['KC_J'], 'KC_ESC')], combo_count: 1 });
        const before = fileService.kbinfoToSvil(structuredClone(kb), true);
        const after = fileService.kbinfoToSvil(structuredClone({ ...kb, cosmetic: { ...kb.cosmetic, combos: { '0': 'Dictation' } } }), true);
        expect(summarizeSvilChange(before, after)).toBe('names');
    });
});

describe('import preflight and sync', () => {
    it('carries the file names to the board, up to its combo count, with no USB traffic', () => {
        const send = vi.spyOn(usbInstance, 'sendSvil');
        const current = board({ cosmetic: { combos: { '1': 'Old', '2': 'Kept' } } });
        const file = board({
            combos: [combo(['KC_J', 'KC_K'], 'KC_ESC'), combo(['KC_D', 'KC_F'], 'KC_ENTER')],
            cosmetic: { combos: { '0': 'Dictation', '5': 'Beyond' } },
        });
        const review = prepareImport(file, current);
        expect(review.errors).toEqual([]);
        // 0 named by the file, 1 cleared by the file, 2 not in the file: kept.
        expect(review.keyboard.cosmetic?.combos).toEqual({ '0': 'Dictation', '2': 'Kept' });
        expect(send).not.toHaveBeenCalled();
        send.mockRestore();
    });

    it('takes names on firmware that cannot store labels', () => {
        const review = prepareImport(board({ cosmetic: { combos: { '0': 'Dictation' } } }), board({ svil_proto: 1 }));
        expect(review.keyboard.cosmetic?.combos).toEqual({ '0': 'Dictation' });
        expect(review.warnings.join(' ')).not.toMatch(/combo/i);
    });

    it('keeps a board name for an unchanged combo when the file has no names (.vil)', () => {
        const current = board({ cosmetic: { combos: { '0': 'Dictation', '1': 'Zoom mute' } } });
        const file = board({ combos: [combo(['KC_J', 'KC_K'], 'KC_ESC'), combo(['KC_D', 'KC_G'], 'KC_ENTER')], cosmetic: undefined });
        expect(prepareImport(file, current).keyboard.cosmetic?.combos).toEqual({ '0': 'Dictation' });
    });

    it('blocks a name that breaks the label rules', () => {
        const review = prepareImport(board({ cosmetic: { combos: { '0': 'x'.repeat(17) } } }), board());
        expect(review.errors.join(' ')).toMatch(/combo 0: .*16 UTF-8 bytes/);
    });

    it('queues no label write for combo names', async () => {
        const current = board();
        const next = prepareImport(board({ cosmetic: { combos: { '0': 'Dictation' } } }), current).keyboard;
        const queue = vi.fn(async () => {});
        const labelService = { saveName: vi.fn() };
        await new ImportService().syncWithKeyboard(next, current, queue, { keyboardService: {}, labelService });
        expect(labelService.saveName).not.toHaveBeenCalled();
        expect(queue.mock.calls.map(c => (c as unknown[])[0])).not.toContainEqual(expect.stringMatching(/combo.*name|Rename combo/i));
    });
});

describe('seeding names from the latest backup', () => {
    it('keeps a name only where keys, output and on/off are unchanged', () => {
        const backup = board({ cosmetic: { combos: { '0': 'Dictation', '1': 'Zoom mute', '2': 'Empty', '9': 'Gone' } } });
        const current = board({
            combos: [combo(['KC_J', 'KC_K'], 'KC_ESC'), combo(['KC_D', 'KC_F'], 'KC_TAB'), combo(['KC_A'], 'KC_B')],
        });
        // 0 unchanged; 1 output changed; 2 now does something else; 9 beyond the table.
        expect(seedComboNames(backup, current)).toEqual({ '0': 'Dictation' });
    });

    it('suppresses a name when the combo was turned off elsewhere', () => {
        const backup = board({ cosmetic: { combos: { '0': 'Dictation' } } });
        const current = board({ combos: [combo(['KC_J', 'KC_K'], 'KC_ESC', 0)] });
        expect(seedComboNames(backup, current)).toBeNull();
    });

    it('never overrides a name the keyboard already has', () => {
        const backup = board({ cosmetic: { combos: { '0': 'Dictation' } } });
        expect(seedComboNames(backup, board({ cosmetic: { combos: { '0': 'Mine' } } }))).toBeNull();
    });

    it('reads combos from a backup .svil', () => {
        const kb = createTestKeyboardInfo({
            kbid: '1234567890ABCDEF',
            combos: [combo(['KC_J', 'KC_K'], 'KC_ESC'), combo(['KC_D'], 'KC_F', 0)], combo_count: 2,
            cosmetic: { combos: { '0': 'Dictation', '1': 'Off one' } },
        });
        const parsed = comboNamesFromSvil(fileService.kbinfoToSvil(structuredClone(kb), true))!;
        expect(seedComboNames(parsed, { ...kb, cosmetic: {} })).toEqual({ '0': 'Dictation', '1': 'Off one' });
    });
});

describe('unsaved edits', () => {
    it('a combo name is not an unsaved edit on a connected board, but is in an offline layout', async () => {
        const { draftOf } = await import('../../src/contexts/KeyboardContext');
        const before = board();
        const after = board({ cosmetic: { combos: { '0': 'Dictation' } } });
        expect(draftOf(after, true)).toBe(draftOf(before, true));
        expect(draftOf(after, false)).not.toBe(draftOf(before, false));
        expect(draftOf(board({ name: 'x', cosmetic: { combos: { '0': 'Dictation' } } }), true)).not.toBe(draftOf(before, true));
    });
});
