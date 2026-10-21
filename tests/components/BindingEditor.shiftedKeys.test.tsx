import { describe, it, expect } from 'vitest';
import { getKeyDisplayLabel, getKeyDisplayText } from '@/utils/key-display';
import { getKeyContents } from '@/utils/keys';
import { getSelectedKeymapKeycode } from '@/hooks/useModifierSide';
import type { KeyboardInfo } from '@/types/keyboard.types';

describe('Shifted symbol resolution in binding editors and panels', () => {
    const mockKeyboard = {
        cosmetic: {},
        combos: [
            {
                cmbid: 0,
                keys: ['LSFT(KC_COMMA)', 'KC_LT', 'LSFT(KC_DOT)', 'LSFT(KC_SLASH)'],
                output: 'LSFT(KC_COMMA)',
                options: 0,
            },
        ],
    } as any as KeyboardInfo;

    it('resolves shifted symbol labels correctly via getKeyDisplayLabel', () => {
        const commaContents = getKeyContents(mockKeyboard, 'LSFT(KC_COMMA)');
        expect(getKeyDisplayLabel('LSFT(KC_COMMA)', commaContents, 'us')).toBe('<');

        const ltContents = getKeyContents(mockKeyboard, 'KC_LT');
        expect(getKeyDisplayLabel('KC_LT', ltContents, 'us')).toBe('<');

        const dotContents = getKeyContents(mockKeyboard, 'LSFT(KC_DOT)');
        expect(getKeyDisplayLabel('LSFT(KC_DOT)', dotContents, 'us')).toBe('>');

        const slashContents = getKeyContents(mockKeyboard, 'LSFT(KC_SLASH)');
        expect(getKeyDisplayLabel('LSFT(KC_SLASH)', slashContents, 'us')).toBe('?');

        const exlmContents = getKeyContents(mockKeyboard, 'LSFT(KC_1)');
        expect(getKeyDisplayLabel('LSFT(KC_1)', exlmContents, 'us')).toBe('!');

        // Letters keep their uppercase form
        const aContents = getKeyContents(mockKeyboard, 'LSFT(KC_A)');
        expect(getKeyDisplayLabel('LSFT(KC_A)', aContents, 'us')).toBe('A');
    });

    it('cleans shift badge for symbols and preserves it for letters in getKeyDisplayText', () => {
        const commaContents = getKeyContents(mockKeyboard, 'LSFT(KC_COMMA)');
        const commaText = getKeyDisplayText('LSFT(KC_COMMA)', '', commaContents, false, 'us');
        expect(commaText.displayLabel).toBe('<');
        expect(commaText.bottomStr).toBe(''); // Badge hidden because '<' already denotes Shift+,

        const aContents = getKeyContents(mockKeyboard, 'LSFT(KC_A)');
        const aText = getKeyDisplayText('LSFT(KC_A)', '', aContents, false, 'us');
        expect(aText.displayLabel).toBe('A');
        expect(aText.bottomStr).toBe('LSFT'); // Badge retained for letter modifiers
    });

    it('resolves keycodes and inner base codes from combo slots holding shifted symbols', () => {
        // Slot 0 holds LSFT(KC_COMMA)
        const code0 = getSelectedKeymapKeycode(mockKeyboard, { type: 'combo', comboId: 0, comboSlot: 0 });
        expect(code0).toBe(0x0236); // QK_MODS (LSFT: 0x0200) | KC_COMMA (0x36)

        // Slot 1 holds KC_LT
        const code1 = getSelectedKeymapKeycode(mockKeyboard, { type: 'combo', comboId: 0, comboSlot: 1 });
        expect(code1).toBe(0x0236);

        // Output holds LSFT(KC_COMMA)
        const codeOutput = getSelectedKeymapKeycode(mockKeyboard, { type: 'combo', comboId: 0, comboSlot: 4 });
        expect(codeOutput).toBe(0x0236);
    });
});
