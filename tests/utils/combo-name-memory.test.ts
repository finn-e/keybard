import { beforeEach, describe, expect, it } from 'vitest';
import { COMBO_NAME_MEMORY_KEY, recallComboNames, rememberComboNames } from '../../src/utils/combo-name-memory';
import { ComboOptions, type KeyboardInfo } from '../../src/types/keyboard.types';

const combo = (keys: string[], output: string, on = true) =>
    ({ cmbid: 0, keys: [...keys, 'KC_NO', 'KC_NO', 'KC_NO', 'KC_NO'].slice(0, 4), output, options: on ? ComboOptions.ENABLED : 0 });
const defaults = () => [combo(['KC_F', 'KC_D'], 'KC_ESC'), combo(['KC_J', 'KC_K'], 'KC_ENTER'), combo([], 'KC_NO')];
const layout = (names: Record<string, string> = {}, combos = defaults()) =>
    ({ combos, cosmetic: { combos: names } }) as unknown as KeyboardInfo;
const named = (kb: KeyboardInfo) => kb.cosmetic?.combos ?? {};

beforeEach(() => localStorage.clear());

describe('combo name memory (names that survive a reload)', () => {
    it('brings a name back to the same combo in a freshly loaded layout', () => {
        rememberComboNames(layout(), layout({ '1': 'Submit' }));
        expect(named(recallComboNames(layout()))).toEqual({ '1': 'Submit' });
    });

    it('follows what the combo does, not its slot', () => {
        rememberComboNames(layout(), layout({ '1': 'Submit' }));
        const moved = layout({}, [combo([], 'KC_NO'), combo([], 'KC_NO'), combo([], 'KC_NO'), combo(['KC_J', 'KC_K'], 'KC_ENTER')]);
        expect(named(recallComboNames(moved))).toEqual({ '3': 'Submit' });
    });

    it('never names an empty combo, and drops a name whose combo changed', () => {
        rememberComboNames(layout(), layout({ '2': 'Nothing yet' }));
        expect(localStorage.getItem(COMBO_NAME_MEMORY_KEY) ?? '{}').toBe('{}');
        const a = layout({ '0': 'Quick escape' });
        rememberComboNames(layout(), a);
        const b = layout({ '0': 'Quick escape' }, [combo(['KC_F', 'KC_D'], 'KC_TAB'), combo(['KC_J', 'KC_K'], 'KC_ENTER'), combo([], 'KC_NO')]);
        rememberComboNames(a, b);
        // The old F+D -> Esc entry is gone; F+D -> Tab now carries the name.
        expect(named(recallComboNames(layout()))).toEqual({});
        expect(named(recallComboNames(layout({}, b.combos)))).toEqual({ '0': 'Quick escape' });
    });

    it('keeps a layout\'s own names, unless told to replace them (the demo)', () => {
        rememberComboNames(layout(), layout({ '0': 'Escape hatch' }));
        expect(named(recallComboNames(layout({ '0': 'Quick escape' })))).toEqual({ '0': 'Quick escape' });
        expect(named(recallComboNames(layout({ '0': 'Quick escape' }), { replace: true }))).toEqual({ '0': 'Escape hatch' });
    });

    it('remembers a removed name, so the demo does not bring its example name back', () => {
        const a = layout({ '0': 'Quick escape' });
        rememberComboNames(null, a);
        rememberComboNames(a, layout({}));
        expect(named(recallComboNames(layout({ '0': 'Quick escape' }), { replace: true }))).toEqual({});
        expect(named(recallComboNames(layout({ '0': 'Quick escape' })))).toEqual({ '0': 'Quick escape' });
    });

    it('treats a combo turned off as a different combo', () => {
        rememberComboNames(layout(), layout({ '1': 'Submit' }));
        const off = layout({}, [combo(['KC_F', 'KC_D'], 'KC_ESC'), combo(['KC_J', 'KC_K'], 'KC_ENTER', false), combo([], 'KC_NO')]);
        expect(named(recallComboNames(off))).toEqual({});
    });

    it('survives broken storage', () => {
        localStorage.setItem(COMBO_NAME_MEMORY_KEY, 'not json');
        expect(named(recallComboNames(layout()))).toEqual({});
        rememberComboNames(layout(), layout({ '1': 'Submit' }));
        expect(named(recallComboNames(layout()))).toEqual({ '1': 'Submit' });
    });
});
