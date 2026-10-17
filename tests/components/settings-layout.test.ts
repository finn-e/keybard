import { describe, expect, it } from 'vitest';
import { SETTINGS } from '../../src/contexts/SettingsContext';
import { SETTINGS_LAYOUTS, SETTINGS_PAGE, SETTINGS_SHOWN_ELSEWHERE, blocksOnPage, settingsOnPage } from '../../src/layout/SecondarySidebar/Panels/settings/layout';

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

    it('has the two groups of option A, with Typing behavior and Developer collapsible', () => {
        expect(SETTINGS_PAGE.map((g) => g.title)).toEqual(['This keyboard', 'Keybard']);
        const collapsible = SETTINGS_PAGE.flatMap((g) => g.sections).filter((s) => s.collapsible).map((s) => s.id);
        expect(collapsible).toEqual(['typing', 'developer']);
    });
});

describe('each organization under review', () => {
    // Before: 7 sections and 6 chips, plus Typing Behavior and Hardware on the rail.
    const BEFORE_SECTIONS = 9;
    const BEFORE_CHIPS = 6;
    const all = settingsOnPage();

    it.each(['a', 'b', 'c'] as const)('%s has every setting and block once, in fewer sections and chips', (id) => {
        const { groups, anchors } = SETTINGS_LAYOUTS[id];
        const names = settingsOnPage(groups);
        expect([...names].sort()).toEqual([...all].sort());
        expect(new Set(names).size).toBe(names.length);
        expect([...blocksOnPage(groups)].sort()).toEqual(['about', 'backups', 'board', 'firmware', 'hardware', 'typing']);
        const sections = groups.flatMap((g) => g.sections);
        expect(sections.length).toBeLessThan(BEFORE_SECTIONS);
        expect(anchors.length).toBeLessThan(BEFORE_CHIPS);
        expect(sections.find((s) => s.id === 'hardware')).toBeDefined();
        const typing = sections.find((s) => s.id === 'typing')!;
        expect(typing.collapsible).toBe(true);
        expect(typing.defaultOpen).toBeFalsy();
    });

    it.each(['a', 'b', 'c'] as const)('%s uses sentence-case section titles', (id) => {
        for (const s of SETTINGS_LAYOUTS[id].groups.flatMap((g) => g.sections)) {
            expect(s.title.slice(1), s.title).toBe(s.title.slice(1).toLowerCase());
        }
    });
});
