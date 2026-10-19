import { act, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MAX_FINGER_CLUSTER_SQUEEZE_U } from "../../src/constants/keyboard-visuals";
import { LayoutSettingsProvider, useLayoutSettings, type KeyVariant } from "../../src/contexts/LayoutSettingsContext";
import { autoKeySizeForWidth, layoutFitScale, type LayoutKeySize } from "../../src/lib/pickerShape";

// The Svalboard layout as laid out in the editor: 23.2 key units wide, 7.5 tall
// (measured from the demo layout at Small: 696px of keys at 30px).
const MAX_X = 23.2;
const MAX_Y = 7.5;
const UNIT: Record<LayoutKeySize, number> = { default: 60, medium: 45, small: 30 };
// As EditorLayout computes them: Medium may squeeze the finger clusters toward the middle.
const widths = {
    default: MAX_X * 60 + 32,
    medium: (MAX_X - 2 * MAX_FINGER_CLUSTER_SQUEEZE_U) * 45 + 32,
    small: MAX_X * 30 + 32,
};
const heights = { default: MAX_Y * 60 + 80, medium: MAX_Y * 45 + 80, small: MAX_Y * 30 + 80 };
// Canvas widths beside the side panel with an L picker (measured, headless Chromium).
const CANVAS = { 1280: 522, 1440: 682, 1920: 1162 } as const;

/** The laid-out width at a size with the squeeze the editor applies, then scaled to fit. */
function shownWidth(canvas: number, size: LayoutKeySize): number {
    const raw = MAX_X * UNIT[size] + 32;
    const squeeze = Math.min(Math.max(0, raw - canvas) / UNIT[size] / 2, MAX_FINGER_CLUSTER_SQUEEZE_U);
    const natural = raw - 2 * squeeze * UNIT[size];
    return natural * layoutFitScale(canvas, natural);
}

describe("the layout is never cropped (L)", () => {
    for (const [vw, canvas] of Object.entries(CANVAS)) {
        it(`shows its full width at ${vw}px, at every key size`, () => {
            for (const size of ["default", "medium", "small"] as const) {
                expect(shownWidth(canvas, size)).toBeLessThanOrEqual(canvas);
            }
        });
    }

    it("scales down continuously, never past fitting and never up", () => {
        expect(layoutFitScale(522, 728)).toBeCloseTo(522 / 728, 2);
        expect(728 * layoutFitScale(522, 728)).toBeLessThanOrEqual(522);
        expect(layoutFitScale(1200, 728)).toBe(1);
        expect(layoutFitScale(0, 728)).toBe(1);
        let last = 1;
        for (let w = 728; w >= 300; w -= 7) {
            const s = layoutFitScale(w, 728);
            expect(s).toBeLessThanOrEqual(last);
            last = s;
        }
    });
});

describe("Auto key size with L: the largest size whose layout fits the width", () => {
    it("picks Small (scaled) at 1280 and 1440, Medium at 1920", () => {
        expect(autoKeySizeForWidth(CANVAS[1280], widths)).toBe("small");
        expect(autoKeySizeForWidth(CANVAS[1440], widths)).toBe("small");
        expect(autoKeySizeForWidth(CANVAS[1920], widths)).toBe("medium");
        expect(autoKeySizeForWidth(widths.default, widths)).toBe("default");
    });

    it("never picks a size that does not fit when a larger one would not either", () => {
        for (let w = 300; w <= 2000; w += 10) {
            const pick = autoKeySizeForWidth(w, widths);
            if (pick !== "small") expect(widths[pick]).toBeLessThanOrEqual(w);
            const larger = (["default", "medium", "small"] as const).slice(0, ["default", "medium", "small"].indexOf(pick));
            for (const size of larger) expect(widths[size]).toBeGreaterThan(w);
        }
    });

    it("ignores the height with L, and keeps it as a limit without", () => {
        let variant: KeyVariant = "default";
        let report: ReturnType<typeof useLayoutSettings>["setMeasuredDimensions"] = () => undefined;
        const Probe = () => {
            const s = useLayoutSettings();
            variant = s.keyVariant;
            report = s.setMeasuredDimensions;
            return null;
        };
        render(<LayoutSettingsProvider><Probe /></LayoutSettingsProvider>);
        // 1920 wide, but a short canvas (the tray takes the rest of the height).
        act(() => report({ containerWidth: CANVAS[1920], containerHeight: 300, keyboardWidths: widths, keyboardHeights: heights, widthOnly: true }));
        expect(variant).toBe("medium");
        act(() => report({ containerWidth: CANVAS[1920], containerHeight: 300, keyboardWidths: widths, keyboardHeights: heights }));
        expect(variant).toBe("small");
    });
});
