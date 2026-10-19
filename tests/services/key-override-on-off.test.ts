import { describe, it, expect } from 'vitest';
import { fileService } from '../../src/services/file.service';
import { createTestKeyboardInfo } from '../fixtures/keyboard-info.fixture';

// The Svalboard enabled flag is options bit 7 (modules/svalboard/core/sval.h).
// That bit is the only owner of on/off in memory; the .svil "on" field is
// derived from it on export and folded back into it on import.
const ENABLED = 0x80;
const ACTIVATIONS = 0x07;

const override = (options: number) => ({
    koid: 0, trigger: 'KC_BSPC', replacement: 'KC_DEL', layers: 0xFFFF,
    trigger_mods: 0x02, negative_mod_mask: 0, suppressed_mods: 0x02, options,
});

const exportSvil = (options: number) => JSON.parse((fileService as any).kbinfoToSvil(
    createTestKeyboardInfo({ kbid: '1234567890ABCDEF', rows: 1, cols: 1, layers: 1, keymap: [[0x04]], key_overrides: [override(options)] } as any), true));

const importOverride = (ko: Record<string, unknown>) => fileService.parseContent(JSON.stringify({
    uid: 12345, sval_protocol: 3, layout: [[['KC_A']]], macro: [], combo: [], tap_dance: [],
    key_override: [{ trigger: 'KC_BSPC', replacement: 'KC_DEL', layers: 0xFFFF, trigger_mods: 2, negative_mod_mask: 0, suppressed_mods: 2, ...ko }],
})).key_overrides![0];

describe('key override on/off has one owner (options bit 7)', () => {
    it('exports "on" from bit 7', () => {
        expect(exportSvil(ACTIVATIONS).key_override[0].on).toBe(false);
        expect(exportSvil(ENABLED | ACTIVATIONS).key_override[0].on).toBe(true);
    });

    it('turn off -> export -> import stays off; on stays on', () => {
        for (const options of [ACTIVATIONS, ENABLED | ACTIVATIONS]) {
            const file = exportSvil(options);
            expect(file.key_override[0].on).toBe((options & ENABLED) !== 0);
            const back = fileService.parseContent(JSON.stringify(file)).key_overrides![0];
            expect(back.options).toBe(options);
        }
    });

    it('keeps no separate enabled field in memory', () => {
        expect(importOverride({ on: false, options: ACTIVATIONS })).not.toHaveProperty('enabled');
    });

    // Precedence when a file has both fields:
    // - "on": false always wins and clears bit 7 (an explicit off).
    // - "on": true defers to options when options is present, because every
    //   Keybard export before this fix wrote "on": true even for overrides
    //   turned off (the off state lived only in bit 7).
    // - With no options field, "on" alone decides, over the QMK default activations.
    it.each([
        [{ on: false, options: ENABLED | ACTIVATIONS }, ACTIVATIONS],
        [{ on: true, options: ACTIVATIONS }, ACTIVATIONS],
        [{ on: true, options: ENABLED | ACTIVATIONS }, ENABLED | ACTIVATIONS],
        [{ on: true }, ENABLED | ACTIVATIONS],
        [{ on: false }, ACTIVATIONS],
        [{ options: ENABLED }, ENABLED],
    ])('imports %j as options %i', (fields, options) => {
        expect(importOverride(fields).options).toBe(options);
    });
});
