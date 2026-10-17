import { describe, expect, it } from "vitest";
import {
    COMBO_INDICATOR_SETTING, comboIndicatorMode, DEFAULT_COMBO_INDICATOR_MODE, FOLD_IDLE_MS, foldIdleMs,
    LEGACY_COMBO_INDICATOR_SETTING, migrateComboIndicatorSetting,
} from "@/lib/comboIndicators";
import { SETTINGS, SETTINGS_CATEGORIES } from "@/contexts/SettingsContext";

describe("combo indicator setting", () => {
    it("migrates the old boolean: false is Off, true is the default", () => {
        expect(migrateComboIndicatorSetting({ [LEGACY_COMBO_INDICATOR_SETTING]: false, other: 1 }))
            .toEqual({ [COMBO_INDICATOR_SETTING]: "off", other: 1 });
        expect(migrateComboIndicatorSetting({ [LEGACY_COMBO_INDICATOR_SETTING]: true }))
            .toEqual({ [COMBO_INDICATOR_SETTING]: DEFAULT_COMBO_INDICATOR_MODE });
        // A stored select value wins over a leftover boolean.
        expect(migrateComboIndicatorSetting({ [LEGACY_COMBO_INDICATOR_SETTING]: false, [COMBO_INDICATOR_SETTING]: "large" }))
            .toEqual({ [COMBO_INDICATOR_SETTING]: "large" });
        const untouched = { a: 1 };
        expect(migrateComboIndicatorSetting(untouched)).toBe(untouched);
    });

    it("defaults to Small and ignores unknown values", () => {
        expect(DEFAULT_COMBO_INDICATOR_MODE).toBe("small");
        expect(comboIndicatorMode(undefined)).toBe("small");
        expect(comboIndicatorMode(true)).toBe("small");
        expect(comboIndicatorMode("large")).toBe("large");
    });

    it("is one select with Off, Small and Large, next to the colorblind switch", () => {
        const def = SETTINGS.find(s => s.name === COMBO_INDICATOR_SETTING)!;
        expect(def.type).toBe("select");
        expect(def.items!.map(i => i.label)).toEqual(["Off", "Small", "Large"]);
        expect(def.defaultValue).toBe("small");
        expect(def.description).toMatch(/Small grows while you move over the keyboard/);
        expect(SETTINGS.find(s => s.name === LEGACY_COMBO_INDICATOR_SETTING)).toBeUndefined();
        const cb = SETTINGS.find(s => s.name === "colorblind-combo-colors")!;
        expect(cb.type).toBe("boolean");
        expect(cb.defaultValue).toBe(false);
        const general = SETTINGS_CATEGORIES.find(c => c.name === "general")!.settings;
        expect(general.indexOf("colorblind-combo-colors")).toBe(general.indexOf(COMBO_INDICATOR_SETTING) + 1);
    });

    it("labels in General use title case", () => {
        const general = SETTINGS_CATEGORIES.find(c => c.name === "general")!.settings;
        const small = new Set(["a", "an", "the", "of", "to", "by", "and", "or"]);
        for (const name of general) {
            const label = SETTINGS.find(s => s.name === name)!.label;
            for (const word of label.replace(/\.\.\.$/, "").split(/[\s-]+/)) {
                if (small.has(word)) continue;
                expect(word[0], `${label}`).toBe(word[0].toUpperCase());
            }
        }
    });

    it("reads a review-only idle delay from the URL", () => {
        expect(foldIdleMs("")).toBe(FOLD_IDLE_MS);
        expect(foldIdleMs("?foldIdle=600")).toBe(600);
        expect(foldIdleMs("?foldIdle=nope")).toBe(FOLD_IDLE_MS);
        expect(foldIdleMs("?foldIdle=-5")).toBe(FOLD_IDLE_MS);
    });
});
