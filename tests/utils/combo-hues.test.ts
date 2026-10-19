import { describe, expect, it } from "vitest";
import { assignComboHues, CB_HUES, HUES, hueDistance, pickOrder, type ComboPalette } from "@/utils/combo-hues";
import { comboTriggerCodes } from "@/utils/combo-membership";
import { ComboOptions, type ComboEntry } from "@/types/keyboard.types";
import { keyService } from "@/services/key.service";
import { demoKeyboard, denseKeyboard, randomKeyboard } from "./combo-test-helpers";

const PALETTES: ComboPalette[] = ["default", "colorblind"];
const combo = (keys: string[], i: number): ComboEntry => ({
    cmbid: i, keys: [...keys, "KC_NO", "KC_NO", "KC_NO", "KC_NO"].slice(0, 4), output: "KC_ESC", options: ComboOptions.ENABLED,
});
const kbOf = (sets: string[][], colors: Record<string, string> = { "0": "green" }) => ({
    combos: sets.map(combo),
    keymap: [[...new Set(sets.flat())].map(k => Number(keyService.parse(k)))],
    cosmetic: { layer_colors: colors },
});
const shareKey = (a: ComboEntry, b: ComboEntry) => {
    const x = comboTriggerCodes(a);
    return [...comboTriggerCodes(b)].some(c => x.has(c));
};

describe("combo hue pick order", () => {
    for (const p of PALETTES) {
        it(`${p}: a permutation where each pick is the farthest from those already picked`, () => {
            const order = pickOrder(p);
            expect([...order].sort()).toEqual(HUES.map((_, i) => i));
            for (let i = 1; i < order.length; i++) {
                const d = (h: number) => Math.min(...order.slice(0, i).map(o => hueDistance(o, h, p)));
                for (const later of order.slice(i + 1)) expect(d(order[i])).toBeGreaterThanOrEqual(d(later) - 1e-9);
            }
        });
    }
});

describe("combo hues across the whole layout", () => {
    const fixed: [string, string[][]][] = [
        ["3 combos, no shared keys", [["KC_A", "KC_B"], ["KC_C", "KC_D"], ["KC_E", "KC_F"]]],
        ["3 combos, all on one key", [["KC_A", "KC_B"], ["KC_A", "KC_C"], ["KC_A", "KC_D"]]],
        ["3 combos, a chain", [["KC_J", "KC_K"], ["KC_K", "KC_L"], ["KC_S", "KC_D"]]],
        ["2 combos far apart", [["KC_Q", "KC_W"], ["KC_O", "KC_P"]]],
    ];
    for (const p of PALETTES) {
        for (const [name, sets] of fixed) {
            for (const color of ["green", "orange", "yellow", "white", "purple", "blue"]) {
                it(`${p}: ${name} on ${color} get distinct hues`, () => {
                    const hues = assignComboHues(kbOf(sets, { "0": color }), p);
                    expect(new Set(hues.values()).size).toBe(sets.length);
                });
            }
        }

        it(`${p}: N <= palette size gives every combo its own hue on many random layouts`, () => {
            for (let seed = 1; seed <= 300; seed++) {
                const kb = randomKeyboard(seed * 7919, { combos: 1 + (seed % HUES.length) });
                const hues = assignComboHues(kb, p);
                expect(hues.size).toBe(kb.combos.length);
                expect(new Set(hues.values()).size).toBe(kb.combos.length);
            }
        });

        it(`${p}: N > palette size keeps sharing combos apart and spreads reuse within 1`, () => {
            let checked = 0;
            for (let seed = 1; seed <= 300; seed++) {
                const kb = randomKeyboard(seed * 104729, { combos: HUES.length + 1 + (seed % 20) });
                if (kb.combos.length <= HUES.length) continue;
                checked++;
                const hues = assignComboHues(kb, p);
                kb.combos.forEach((a, i) => kb.combos.forEach((b, j) => {
                    if (i < j && shareKey(a, b)) expect(hues.get(i), `${kb.name}: ${i} and ${j}`).not.toBe(hues.get(j));
                }));
                const uses = HUES.map((_, h) => [...hues.values()].filter(v => v === h).length);
                expect(Math.max(...uses) - Math.min(...uses), `${kb.name} ${uses}`).toBeLessThanOrEqual(1);
            }
            expect(checked).toBeGreaterThan(200);
        });

        it(`${p}: with no layer clash, combos take hues in pick order by combo number`, () => {
            const hues = assignComboHues(kbOf([["KC_A", "KC_B"], ["KC_C", "KC_D"], ["KC_E", "KC_F"]], { "0": "sidebar" }), p);
            expect([0, 1, 2].map(i => hues.get(i))).toEqual(pickOrder(p).slice(0, 3));
        });
    }

    it("is deterministic by combo number", () => {
        for (const make of [demoKeyboard, denseKeyboard]) {
            expect([...assignComboHues(make())]).toEqual([...assignComboHues(make())]);
        }
    });

    it("the default and colorblind palettes have the same number of slots", () => {
        expect(CB_HUES.length).toBe(HUES.length);
    });
});
