import { describe, expect, it } from "vitest";

import {
    CANVAS_CONTROLS_INSET_PX, effectivePickerShape, fittedTrayHeight, isLShape, LAYOUT_MARGIN_PX, layoutCanvasNeed, lSurfacePath,
    openTraySizing, pickerShapeFromSearch, standardKeysInPlay, TRAY_EDGE_PX, TRAY_HANDLE_PX, TRAY_MAX_KEY_PX, TRAY_MIN_KEY_PX,
    QWERTY_KEY_PX, trayHeightFor, trayKeyboardHeight, trayKeyboardScale, trayReserve, trayState, trayVisibleHeight,
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
        expect(trayKeyboardScale(600, 400, 500, 200)).toBeCloseTo(1.2);
        expect(trayKeyboardScale(800, 150, 500, 200)).toBeCloseTo(0.8);
        expect(trayKeyboardScale(100, 100, 500, 200) * QWERTY_KEY_PX).toBeGreaterThanOrEqual(TRAY_MIN_KEY_PX);
    });
});

describe("tray sized from the layout", () => {
    const at1440 = { viewportHeight: 900, canvasTop: 74, contentHeight: 214 };

    it("gives the layout its content plus a margin, with the size controls clear of the keyboard", () => {
        // Keyboard to 370, add-layer row to 414, controls 30px tall.
        expect(layoutCanvasNeed({ contentBottom: 414, keyboardBottom: 370, controlsHeight: 30 }))
            .toBe(370 + LAYOUT_MARGIN_PX + 30 + CANVAS_CONTROLS_INSET_PX);
        // Short controls: the content's bottom decides.
        expect(layoutCanvasNeed({ contentBottom: 414, keyboardBottom: 370, controlsHeight: 10 })).toBe(414 + LAYOUT_MARGIN_PX);
        expect(layoutCanvasNeed({ contentBottom: 0, keyboardBottom: 0, controlsHeight: 30 })).toBe(0);
    });

    it("takes all the height the layout leaves", () => {
        const s = openTraySizing({ ...at1440, layoutNeed: 424 });
        expect(s.fills).toBe(true);
        expect(s.height).toBe(900 - TRAY_EDGE_PX - 74 - 424);
        expect(s.keyboardHeight).toBe(trayKeyboardHeight(s.height));
        // Canvas top + layout + tray + the gap under it is the whole window.
        expect(74 + 424 + s.height + TRAY_EDGE_PX).toBe(900);
    });

    it("leaves room for anything else reserved under the canvas", () => {
        expect(openTraySizing({ ...at1440, layoutNeed: 424, reserveBelow: 20 }).height)
            .toBe(openTraySizing({ ...at1440, layoutNeed: 424 }).height - 20);
    });

    it("keeps the capped size when the layout needs more room (Normal keys, a short window)", () => {
        const s = openTraySizing({ ...at1440, layoutNeed: 700 });
        expect(s.fills).toBe(false);
        expect(s.height).toBe(fittedTrayHeight(trayHeightFor(900), 214));
        expect(s.keyboardHeight).toBe(trayKeyboardHeight(trayHeightFor(900)));
        const short = openTraySizing({ viewportHeight: 720, canvasTop: 74, layoutNeed: 443, contentHeight: 180 });
        expect(short.fills).toBe(false);
        expect(short.height).toBe(fittedTrayHeight(trayHeightFor(720), 180));
    });

    it("keeps the capped size until the layout is measured", () => {
        expect(openTraySizing({ ...at1440, layoutNeed: 0 }).fills).toBe(false);
    });

    it("never gives the tray less than it had before", () => {
        for (const need of [300, 424, 500, 560, 600, 800]) {
            expect(openTraySizing({ ...at1440, layoutNeed: need }).height)
                .toBeGreaterThanOrEqual(fittedTrayHeight(trayHeightFor(900), 214));
        }
    });
});

describe("tray key size", () => {
    const natural = { w: 496, h: 200 };
    const keyPx = (w: number, h: number) => trayKeyboardScale(w, h, natural.w, natural.h) * QWERTY_KEY_PX;

    it("fills the width when the tray is wide enough but short", () => {
        // 680px wide, 316px tall: width-limited.
        expect(keyPx(680, 316)).toBeCloseTo(680 / natural.w * QWERTY_KEY_PX);
    });

    it("fills the height when the tray is wide (Lfull)", () => {
        expect(keyPx(1192, 316)).toBeCloseTo(316 / natural.h * QWERTY_KEY_PX);
    });

    it("keeps its shape: one scale for both directions", () => {
        const s = trayKeyboardScale(1192, 316, natural.w, natural.h);
        expect(natural.w * s).toBeLessThanOrEqual(1192 + 0.001);
        expect(natural.h * s).toBeLessThanOrEqual(316 + 0.001);
    });

    it("caps keys at the largest size", () => {
        expect(keyPx(4000, 2000)).toBeCloseTo(TRAY_MAX_KEY_PX);
        expect(TRAY_MAX_KEY_PX).toBe(64);
    });

    it("never drops keys under 24px", () => {
        expect(keyPx(100, 60)).toBeCloseTo(TRAY_MIN_KEY_PX);
    });
});

describe("the multi-layer view", () => {
    it("still collapses the tray to its handle, whatever size it would open to", () => {
        const s = openTraySizing({ viewportHeight: 900, canvasTop: 74, layoutNeed: 424, contentHeight: 214 });
        expect(trayState({ ...base, multiLayer: true })).toBe("handle");
        expect(trayReserve("handle", s.height)).toBe(TRAY_HANDLE_PX);
        expect(trayVisibleHeight("handle", s.height)).toBe(TRAY_HANDLE_PX);
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
