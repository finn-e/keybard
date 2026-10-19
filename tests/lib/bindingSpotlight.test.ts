import { describe, expect, it } from 'vitest';
import {
    BINDING_EDITOR_PANELS, bindingEditorHeading, bindingEditorKind, effectivePickerMode, spotlightHint, isBindingEditorOpen, pickerCategoryForRail, spotStrength, usablePickerCategories,
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

describe('back arrow callout', () => {
    it('names the editor by kind and number', () => {
        expect(spotlightHint(bindingEditorKind('combos', 0))).toBe('Done with Combo 0? Go back to use the rest.');
        expect(spotlightHint(bindingEditorKind('tapdances', 2))).toBe('Done with Tap Dance 2? Go back to use the rest.');
        expect(bindingEditorKind('macros', 1)).toBe('Macro 1');
        expect(bindingEditorKind('overrides', 4)).toBe('Override 4');
        expect(bindingEditorKind('altrepeat', 5)).toBe('Alt-Repeat 5');
        expect(bindingEditorKind('leaders', 6)).toBe('Leader 6');
    });

    it('shares the kind and number with the picker header', () => {
        for (const editor of BINDING_EDITOR_PANELS) {
            const kind = bindingEditorKind(editor, 3);
            expect(bindingEditorHeading(editor, 3)).toBe(`Editing ${kind}`);
            expect(spotlightHint(kind)).toBe(`Done with ${kind}? Go back to use the rest.`);
        }
        expect(bindingEditorHeading('tapdances', 3)).toBe('Editing Tap Dance 3');
    });

    it('picks the scrim strength from ?spot, the prototype strength by default', () => {
        expect(spotStrength('')).toBe('medium');
        expect(spotStrength('?spot=soft')).toBe('soft');
        expect(spotStrength('?x=1&spot=deep')).toBe('deep');
        expect(spotStrength('?spot=sparkle')).toBe('medium');
        // The back-arrow cue is the ring; its old review parameter is gone.
        expect(spotStrength('?backPulse=glow')).toBe('medium');
    });
});
