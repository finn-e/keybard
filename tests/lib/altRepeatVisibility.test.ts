import { describe, expect, it } from 'vitest';

import { SETTINGS, SETTINGS_CATEGORIES } from '../../src/contexts/SettingsContext';
import { panelAllowed, SHOW_ALT_REPEAT_SETTING } from '../../src/lib/altRepeatVisibility';

describe('Show Alt-Repeat preference', () => {
    it('is an app preference in General, off by default', () => {
        const def = SETTINGS.find(s => s.name === SHOW_ALT_REPEAT_SETTING);
        expect(def).toMatchObject({ label: 'Show Alt-Repeat', type: 'boolean', defaultValue: false });
        expect(def?.scope).toBeUndefined();
        const general = SETTINGS_CATEGORIES.find(c => c.name === 'general')!;
        expect(general.settings).toContain(SHOW_ALT_REPEAT_SETTING);
    });

    it('only gates the Alt-Repeat panel', () => {
        expect(panelAllowed('altrepeat', false)).toBe(false);
        expect(panelAllowed('altrepeat', true)).toBe(true);
        for (const panel of ['combos', 'overrides', 'leaders', null, undefined]) expect(panelAllowed(panel, false)).toBe(true);
    });
});
