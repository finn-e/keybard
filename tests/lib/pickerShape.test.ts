import { describe, expect, it } from "vitest";

import {
    effectivePickerShape, fittedTrayHeight, isLShape, lSurfacePath, pickerShapeFromSearch, standardKeysInPlay,
    TRAY_HANDLE_PX, TRAY_MIN_KEY_PX, QWERTY_KEY_PX, trayHeightFor, trayKeyboardScale, trayReserve, trayState, trayVisibleHeight,
    type TrayInputs,
} from "../../src/lib/pickerShape";

const base: TrayInputs = {
    shape: "L", panelOpen: true, editorOpen: false, activePanel: "keyboard", pickerMode: "keyboard", multiLayer: false, toggled: false,
};

describe("pickerShape param", () => {
    it("reads L and Lfull and ignores anything else", () => {
        expect(pickerShapeFromSearch("?pickerShape=L")).toBe("L");
        expect(pickerShapeFromSearch("?comboEditor=panel&pickerShape=Lfull")).toBe("Lfull");
        expect(pickerShapeFromSearch("")).toBe("rect");
        expect(pickerShapeFromSearch("?pickerShape=l")).toBe("rect");
        expect(pickerShapeFromSearch("?pickerShape=bogus")).toBe("rect");
    });

    it("has no effect in the bottom bar", () => {
        expect(effectivePickerShape("L", "bottombar")).toBe("rect");
        expect(effectivePickerShape("Lfull", "bottombar")).toBe("rect");
        expect(effectivePickerShape("L", "sidebar")).toBe("L");
        expect(trayState({ ...base, shape: effectivePickerShape("L", "bottombar") })).toBe("hidden");
    });

    it("knows which shapes are L", () => {
        expect(isLShape("L")).toBe(true);
        expect(isLShape("Lfull")).toBe(true);
        expect(isLShape("rect")).toBe(false);
    });
});

describe("tray visibility", () => {
    it("opens for the Standard Keys panel (a layout key being assigned)", () => {
        expect(trayState(base)).toBe("open");
    });

    it("opens while an editor picks from Standard Keys, and collapses for any other category", () => {
        const editing = { ...base, editorOpen: true, activePanel: "combos" };
        expect(trayState({ ...editing, pickerMode: "keyboard" })).toBe("open");
        for (const mode of ["layers", "special", "mouse", "pointing", "macros", "tapdances"]) {
            expect(trayState({ ...editing, pickerMode: mode })).toBe("hidden");
        }
    });

    it("stays hidden when nothing is being picked from Standard Keys", () => {
        expect(trayState({ ...base, activePanel: "combos" })).toBe("hidden");
        expect(trayState({ ...base, activePanel: "layers" })).toBe("hidden");
        expect(trayState({ ...base, panelOpen: false })).toBe("hidden");
        expect(standardKeysInPlay({ ...base, panelOpen: false })).toBe(false);
    });

    it("never shows with the usual rectangle", () => {
        expect(trayState({ ...base, shape: "rect" })).toBe("hidden");
    });

    it("collapses to its handle by hand", () => {
        expect(trayState({ ...base, toggled: true })).toBe("handle");
    });

    it("collapses to a handle in the multi-layer view, and expands over the layers", () => {
        expect(trayState({ ...base, multiLayer: true })).toBe("handle");
        expect(trayState({ ...base, multiLayer: true, toggled: true })).toBe("overlay");
        expect(trayState({ ...base, multiLayer: true, activePanel: "macros" })).toBe("hidden");
    });

    it("gives the layout back the tray's height, except the handle, and overlays without taking more", () => {
        expect(trayReserve("open", 250)).toBe(250);
        expect(trayReserve("handle", 250)).toBe(TRAY_HANDLE_PX);
        expect(trayReserve("overlay", 250)).toBe(TRAY_HANDLE_PX);
        expect(trayReserve("hidden", 250)).toBe(0);
        expect(trayVisibleHeight("overlay", 250)).toBe(250);
        expect(trayVisibleHeight("handle", 250)).toBe(TRAY_HANDLE_PX);
        expect(trayVisibleHeight("hidden", 250)).toBe(0);
    });
});

describe("tray sizes", () => {
    it("takes a share of the window, within limits", () => {
        expect(trayHeightFor(720)).toBe(216);
        expect(trayHeightFor(900)).toBe(270);
        expect(trayHeightFor(1600)).toBe(280);
        expect(trayHeightFor(300)).toBe(160);
    });

    it("fits its keyboard and never exceeds the budget", () => {
        expect(fittedTrayHeight(270, 0)).toBe(270);
        expect(fittedTrayHeight(270, 180)).toBe(180 + TRAY_HANDLE_PX);
        expect(fittedTrayHeight(270, 400)).toBe(270);
    });

    it("scales the keyboard to fit, but keeps keys at least 24px", () => {
        expect(trayKeyboardScale(1000, 400, 500, 200)).toBe(1.6);
        expect(trayKeyboardScale(600, 400, 500, 200)).toBeCloseTo(1.2);
        expect(trayKeyboardScale(800, 150, 500, 200)).toBeCloseTo(0.8);
        expect(trayKeyboardScale(100, 100, 500, 200) * QWERTY_KEY_PX).toBeGreaterThanOrEqual(TRAY_MIN_KEY_PX);
    });
});

describe("the L outline", () => {
    const g = { left: 0, inner: 500, right: 1400, top: 0, trayTop: 600, bottom: 880 };

    it("is one closed shape with a concave fillet where the tray meets the panel", () => {
        const d = lSurfacePath(g, 16);
        expect(d.startsWith("M")).toBe(true);
        expect(d.endsWith("Z")).toBe(true);
        // Six corners: five convex (sweep 1) and one concave (sweep 0).
        expect(d.match(/A[^A-Z]*0 0 1 /g)).toHaveLength(5);
        expect(d.match(/A[^A-Z]*0 0 0 /g)).toHaveLength(1);
        expect(d).toContain("V584");
        expect(d).toContain("516,600");
    });

    it("is the panel's rounded rectangle with no tray", () => {
        const d = lSurfacePath({ ...g, trayTop: 880 }, 16);
        expect(d.match(/A/g)).toHaveLength(4);
        expect(d).not.toContain("0 0 0 ");
    });

    it("shrinks the tray's corners for a short tray", () => {
        const d = lSurfacePath({ ...g, trayTop: 870 }, 16);
        expect(d).toContain("A5,5 0 0 0");
    });
});
