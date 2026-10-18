import { describe, expect, it } from 'vitest';
import { SETTINGS } from '../../src/contexts/SettingsContext';
import { SETTINGS_PAGE, SETTINGS_SHOWN_ELSEWHERE, settingsOnPage } from '../../src/layout/SecondarySidebar/Panels/settings/layout';

describe('Settings page declaration', () => {
    const onPage = settingsOnPage();

    it('names only settings that exist, each once', () => {
        const names = new Set(SETTINGS.map((s) => s.name));
        for (const name of onPage) expect(names.has(name), name).toBe(true);
        expect(new Set(onPage).size).toBe(onPage.length);
    });

    it('never places board configuration on the page', () => {
        for (const name of onPage) {
            expect(SETTINGS.find((s) => s.name === name)?.scope, name).not.toBe('hardware');
        }
    });

    it('places every setting on the page or names its one home elsewhere, never both', () => {
        for (const def of SETTINGS) {
            const here = onPage.includes(def.name);
            const elsewhere = def.name in SETTINGS_SHOWN_ELSEWHERE;
            expect(here || elsewhere, `${def.name} needs a row in settings/layout.ts or an entry in SETTINGS_SHOWN_ELSEWHERE`).toBe(true);
            expect(here && elsewhere, def.name).toBe(false);
        }
    });

    it('leaves out the retired settings: binding editor placement, ball gloss and sparkle', () => {
        for (const name of ['combo-editor-placement', 'pointing-ball-gloss', 'pointing-sparkle']) {
            expect(onPage).not.toContain(name);
            expect(SETTINGS.find((s) => s.name === name), name).toBeUndefined();
        }
    });

    it('has the three groups and only Developer collapsible', () => {
        expect(SETTINGS_PAGE.map((g) => g.title)).toEqual(['This keyboard', 'This browser', 'Keybard']);
        const collapsible = SETTINGS_PAGE.flatMap((g) => g.sections).filter((s) => s.collapsible).map((s) => s.id);
        expect(collapsible).toEqual(['developer']);
    });
});
