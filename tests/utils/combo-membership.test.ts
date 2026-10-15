import { describe, expect, it } from "vitest";
import { keyService } from "@/services/key.service";
import { ComboOptions, type ComboEntry } from "@/types/keyboard.types";
import { buildComboMembershipIndex, membershipCode } from "@/utils/combo-membership";
import { shortKeyName, keyComboAriaLabel } from "@/utils/combo-labels";

const combo = (keys: string[], output = "KC_ESC", on = true): ComboEntry =>
    ({ cmbid: 0, keys: [...keys, "KC_NO", "KC_NO", "KC_NO", "KC_NO"].slice(0, 4), output, options: on ? ComboOptions.ENABLED : 0 });
const code = (k: string) => Number(keyService.parse(k));

describe("buildComboMembershipIndex", () => {
    it("indexes trigger keys by numeric code, so aliases match", () => {
        const index = buildComboMembershipIndex([combo(["KC_ENT", "KC_J"])]);
        expect(code("KC_ENT")).toBe(code("KC_ENTER"));
        expect(index.get(code("KC_ENTER"))?.map(m => m.index)).toEqual([0]);
        expect(index.get(code("KC_J"))?.[0].inputs).toEqual(["KC_ENT", "KC_J"]);
    });

    it("lists a key's combos ascending by combo number", () => {
        const index = buildComboMembershipIndex([combo(["KC_A", "KC_B"]), combo(["KC_C", "KC_D"]), combo(["KC_A", "KC_C"]), combo(["KC_B", "KC_A"])]);
        expect(index.get(code("KC_A"))?.map(m => m.index)).toEqual([0, 2, 3]);
        expect(index.get(code("KC_C"))?.map(m => m.index)).toEqual([1, 2]);
    });

    it("counts a key once per combo even when a combo lists it twice", () => {
        const index = buildComboMembershipIndex([combo(["KC_A", "KC_A", "KC_B"])]);
        expect(index.get(code("KC_A"))).toHaveLength(1);
    });

    it("never indexes KC_NO, KC_TRNS or outputs, and skips combos with no keys", () => {
        const index = buildComboMembershipIndex([combo(["KC_TRNS", "KC_A"], "KC_Z"), combo([], "KC_Y")]);
        expect(index.has(0)).toBe(false);
        expect(index.has(1)).toBe(false);
        expect(index.has(code("KC_Z"))).toBe(false);
        expect(index.has(code("KC_Y"))).toBe(false);
        expect(index.get(code("KC_A"))?.map(m => m.index)).toEqual([0]);
    });

    it("keeps mod-taps as their full code and records enabled state", () => {
        const index = buildComboMembershipIndex([combo(["LGUI_T(KC_TAB)", "KC_LSHIFT"], "KC_LGUI", false)]);
        expect(index.has(code("KC_TAB"))).toBe(false);
        const [m] = index.get(code("LGUI_T(KC_TAB)"))!;
        expect(m.enabled).toBe(false);
    });
});

describe("membershipCode", () => {
    it("a transparent key shows the combos of the key it falls through to", () => {
        expect(membershipCode(1, code("KC_J"))).toBe(code("KC_J"));
        expect(membershipCode(1, undefined)).toBe(0);
        expect(membershipCode(1, 1)).toBe(0);
        expect(membershipCode(code("KC_K"), code("KC_J"))).toBe(code("KC_K"));
    });
});

describe("combo labels", () => {
    it("names keys briefly", () => {
        expect(shortKeyName("KC_ESCAPE")).toBe("Esc");
        expect(shortKeyName("LCTL(KC_C)")).toBe("Ctrl C");
        expect(shortKeyName("LGUI_T(KC_TAB)")).toBe("Tab / GUI");
        expect(shortKeyName("KC_J")).toBe("J");
    });
    it("describes a key's combos for assistive tech", () => {
        expect(keyComboAriaLabel("J", [{ index: 0, enabled: true, output: "KC_ESCAPE", inputs: ["KC_J", "KC_K"] }, { index: 4, enabled: false, output: "KC_ENTER", inputs: ["KC_D", "KC_J"] }]))
            .toBe("J: in 2 combos. Combo 0: J plus K gives Esc. Combo 4, off: D plus J gives Enter");
    });
});
