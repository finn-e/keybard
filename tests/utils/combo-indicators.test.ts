import { describe, expect, it } from "vitest";
import {
    COMBO_INDICATOR_SETTING, comboIndicatorMode, comboIndicatorsOn, DEFAULT_COMBO_INDICATOR_MODE, FOLD_IDLE_MS, foldIdleMs,
    LEGACY_COMBO_INDICATOR_SETTING, migrateComboIndicatorSetting,
} from "@/lib/comboIndicators";
import { SETTINGS, SETTINGS_CATEGORIES } from "@/contexts/SettingsContext";

describe("combo indicator setting", () => {
    it("migrates the old boolean show-combo-indicators to the switch", () => {
        expect(migrateComboIndicatorSetting({ [LEGACY_COMBO_INDICATOR_SETTING]: false, other: 1 }))
            .toEqual({ [COMBO_INDICATOR_SETTING]: false, other: 1 });
        expect(migrateComboIndicatorSetting({ [LEGACY_COMBO_INDICATOR_SETTING]: true }))
            .toEqual({ [COMBO_INDICATOR_SETTING]: true });
        // A stored current value wins over a leftover boolean.
        expect(migrateComboIndicatorSetting({ [LEGACY_COMBO_INDICATOR_SETTING]: false, [COMBO_INDICATOR_SETTING]: "large" }))
            .toEqual({ [COMBO_INDICATOR_SETTING]: true });
        expect(migrateComboIndicatorSetting({ [LEGACY_COMBO_INDICATOR_SETTING]: true, [COMBO_INDICATOR_SETTING]: false }))
            .toEqual({ [COMBO_INDICATOR_SETTING]: false });
        const untouched = { a: 1 };
        expect(migrateComboIndicatorSetting(untouched)).toBe(untouched);
        const current = { [COMBO_INDICATOR_SETTING]: true };
        expect(migrateComboIndicatorSetting(current)).toBe(current);
    });

    it("migrates the old select: Large and Small are on, Off stays off", () => {
        expect(migrateComboIndicatorSetting({ [COMBO_INDICATOR_SETTING]: "large" })).toEqual({ [COMBO_INDICATOR_SETTING]: true });
        expect(migrateComboIndicatorSetting({ [COMBO_INDICATOR_SETTING]: "small" })).toEqual({ [COMBO_INDICATOR_SETTING]: true });
        expect(migrateComboIndicatorSetting({ [COMBO_INDICATOR_SETTING]: "off" })).toEqual({ [COMBO_INDICATOR_SETTING]: false });
    });

    it("defaults to on and reads every old value", () => {
        expect(DEFAULT_COMBO_INDICATOR_MODE).toBe("small");
        expect(comboIndicatorsOn(undefined)).toBe(true);
        expect(comboIndicatorsOn("nonsense")).toBe(true);
        expect(comboIndicatorsOn(false)).toBe(false);
        expect(comboIndicatorsOn("off")).toBe(false);
        expect(comboIndicatorMode(undefined)).toBe("small");
        expect(comboIndicatorMode(true)).toBe("small");
        expect(comboIndicatorMode("large")).toBe("small");
        expect(comboIndicatorMode(false)).toBe("off");
    });

    it("is one on/off switch, on by default, next to the colorblind switch", () => {
        const def = SETTINGS.find(s => s.name === COMBO_INDICATOR_SETTING)!;
        expect(def.type).toBe("boolean");
        expect(def.items).toBeUndefined();
        expect(def.defaultValue).toBe(true);
        expect(def.description).toMatch(/grow while you move over the keyboard/);
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
            // The deprecated list keeps names whose definitions left with the Settings page (layout.ts).
            const def = SETTINGS.find(s => s.name === name);
            if (!def) continue;
            const label = def.label;
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
