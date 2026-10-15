import { describe, expect, it } from 'vitest';
import {
    BINDING_EDITOR_PANELS, effectivePickerMode, isBindingEditorOpen, pickerCategoryForRail, usablePickerCategories,
} from '@/lib/bindingSpotlight';

const ALL = ['keyboard', 'pointing', 'special', 'layers', 'mouse', 'tapdances', 'macros'];

describe('binding editor picker categories', () => {
    it('knows which panels are binding editors', () => {
        expect([...BINDING_EDITOR_PANELS]).toEqual(['tapdances', 'combos', 'macros', 'overrides', 'altrepeat', 'leaders']);
        expect(isBindingEditorOpen('combos', 3)).toBe(true);
        expect(isBindingEditorOpen('combos', null)).toBe(false);
        expect(isBindingEditorOpen('keyboard', 3)).toBe(false);
        expect(isBindingEditorOpen(null, 0)).toBe(false);
    });

    it('excludes the categories an editor cannot hold', () => {
        expect(usablePickerCategories('tapdances')).toEqual(ALL.filter(c => c !== 'tapdances'));
        expect(usablePickerCategories('macros')).toEqual(ALL.filter(c => c !== 'macros'));
        for (const editor of ['combos', 'overrides', 'altrepeat', 'leaders']) expect(usablePickerCategories(editor)).toEqual(ALL);
    });

    it('maps usable rail items to picker categories and covers everything else', () => {
        expect(pickerCategoryForRail('pointing', 'combos')).toBe('pointing');
        expect(pickerCategoryForRail('tapdances', 'combos')).toBe('tapdances');
        expect(pickerCategoryForRail('tapdances', 'tapdances')).toBeNull();
        expect(pickerCategoryForRail('macros', 'macros')).toBeNull();
        for (const covered of ['combos', 'overrides', 'altrepeat', 'leaders', 'layouts', 'trainer', 'quickstart', 'manual', 'about', 'settings', 'dynamic-menu-0']) {
            expect(pickerCategoryForRail(covered, 'combos')).toBeNull();
        }
    });

    it('falls back to Standard Keys when the chosen category is invalid for the editor', () => {
        expect(effectivePickerMode('tapdances', 'tapdances')).toBe('keyboard');
        expect(effectivePickerMode('tapdances', 'combos')).toBe('tapdances');
        expect(effectivePickerMode('macros', 'macros')).toBe('keyboard');
    });
});
