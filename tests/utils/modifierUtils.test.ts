import { describe, expect, it } from "vitest";

import { keyService } from "../../src/services/key.service";
import {
    applyModifiers,
    decomposeKeycode,
    getKeycodeModifierSide,
    getOsmKeycode,
    MASK_TO_MODIFIERS,
    Modifier,
} from "../../src/utils/modifierUtils";

const KC_A = 0x04;

describe("modifierUtils: left/right modifier side", () => {
    it("defaults to left-hand chords, mod-taps and one-shots", () => {
        expect(applyModifiers("KC_A", ["Shift"], false)).toBe("LSFT(KC_A)");
        expect(applyModifiers("KC_A", ["Ctrl"], true)).toBe("LCTL_T(KC_A)");
        expect(getOsmKeycode(["Alt"])).toBe("OSM(MOD_LALT)");
    });

    it("builds right-hand chords, mod-taps and one-shots", () => {
        expect(applyModifiers("KC_A", ["Shift"], false, "right")).toBe("RSFT(KC_A)");
        expect(applyModifiers("KC_A", ["Ctrl", "Shift"], false, "right")).toBe("RSC(KC_A)");
        expect(applyModifiers("KC_A", ["Ctrl"], true, "right")).toBe("RCTL_T(KC_A)");
        expect(applyModifiers("KC_NO", ["Gui"], false, "right")).toBe("RGUI(KC_NO)");
        expect(getOsmKeycode(["Ctrl", "Gui"], "right")).toBe("OSM(MOD_RCTL|MOD_RGUI)");
    });

    // Every mask, both hands and all three kinds must be a keycode the keymap
    // understands, and it must land in the right QMK range with the right bit.
    it.each(Object.entries(MASK_TO_MODIFIERS))("mask %s parses to the expected numeric keycode", (maskStr, mods) => {
        const mask = Number(maskStr);
        const modifiers = mods as Modifier[];
        for (const side of ["left", "right"] as const) {
            const rightBit = side === "right" ? 0x10 : 0;

            const chord = keyService.parse(applyModifiers("KC_A", modifiers, false, side));
            expect(chord, `${side} chord`).toBe(((mask | rightBit) << 8) | KC_A);

            const modTap = keyService.parse(applyModifiers("KC_A", modifiers, true, side));
            expect(modTap, `${side} mod-tap`).toBe(0x2000 | ((mask | rightBit) << 8) | KC_A);

            const osm = keyService.parse(getOsmKeycode(modifiers, side)!);
            expect(osm, `${side} one-shot`).toBe(0x52A0 | mask | rightBit);
        }
    });

    it("decomposes right-hand keycodes and reports their side", () => {
        expect(decomposeKeycode(0x1204)).toMatchObject({ modifiers: ["Shift"], baseKeycode: "KC_A", isModTap: false, side: "right" });
        expect(decomposeKeycode(0x3104)).toMatchObject({ modifiers: ["Ctrl"], isModTap: true, side: "right" });
        expect(decomposeKeycode(0x0204)).toMatchObject({ side: "left" });
    });

    it("reads the side of plain modifiers, chords, mod-taps and one-shots", () => {
        expect(getKeycodeModifierSide(0xE1)).toBe("left");   // KC_LSFT
        expect(getKeycodeModifierSide(0xE5)).toBe("right");  // KC_RSFT
        expect(getKeycodeModifierSide(0x0104)).toBe("left"); // LCTL(KC_A)
        expect(getKeycodeModifierSide(0x1404)).toBe("right"); // RALT(KC_A)
        expect(getKeycodeModifierSide(0x3804)).toBe("right"); // RGUI_T(KC_A)
        expect(getKeycodeModifierSide(0x52A2)).toBe("left"); // OSM(MOD_LSFT)
        expect(getKeycodeModifierSide(0x52B2)).toBe("right"); // OSM(MOD_RSFT)
        expect(getKeycodeModifierSide(KC_A)).toBeNull();
        expect(getKeycodeModifierSide(undefined)).toBeNull();
    });
});
