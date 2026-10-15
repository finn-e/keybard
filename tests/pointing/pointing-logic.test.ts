import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SETTINGS, SETTINGS_CATEGORIES, POINTING_GLOSS_SETTING, POINTING_SPARKLE_SETTING } from "@/contexts/SettingsContext";
import { BALLS, coatAt, GLOSS_DEFAULT, MAT_ORDER, SPARKLE_DEFAULT, spkAt } from "@/components/pointing-viz/webgl/materials";
import { _setWebGLDisabledForTest, drawDevice, rotFromEuler, webglAvailable } from "@/components/pointing-viz/webgl/renderer";
import { demoReport, pointingDemoFromSearch } from "@/features/pointing-demo";
import { freeCircle, MM_PER_U, placeDevice, placedKeyRects, type KeyRect } from "@/utils/pointing-geometry";
import { boostLabel, multiplierLabels, pointingFactors, sniperLabel } from "@/utils/pointing-multiplier";
import { parsePointingMotion, SVIL_FLAG2_POINTING_MOTION } from "@/utils/pointing-motion";

const QK_USER_0 = 0x7e40;

/** The bundled demo layout's keys (the QWERTY Example). */
function demoKeys(): KeyRect[] {
    const svil = JSON.parse(readFileSync(resolve(process.cwd(), "src/default-layouts/sval-default.svil"), "utf8"));
    return Object.values(svil.keylayout as Record<string, KeyRect>).map(({ x, y, w, h }) => ({ x, y, w, h }));
}
const overlaps = (k: KeyRect, cx: number, cy: number, r: number) => {
    const dx = Math.max(k.x - cx, 0, cx - (k.x + k.w)), dy = Math.max(k.y - cy, 0, cy - (k.y + k.h));
    return Math.hypot(dx, dy) < r;
};

describe("preferences and defaults", () => {
    it("Ball gloss and Sparkle density are app sliders, 0..1, defaults 0.25 and 0.75, next to Appearance", () => {
        const gloss = SETTINGS.find((s) => s.name === POINTING_GLOSS_SETTING)!;
        const sparkle = SETTINGS.find((s) => s.name === POINTING_SPARKLE_SETTING)!;
        for (const s of [gloss, sparkle]) {
            expect(s).toMatchObject({ type: "slider", min: 0, max: 1, step: 0.01 });
            expect(s.scope).toBeUndefined(); // an app preference, not a board setting
        }
        expect(gloss.defaultValue).toBe(0.25);
        expect(sparkle.defaultValue).toBe(0.75);
        expect(GLOSS_DEFAULT).toBe(0.25);
        expect(SPARKLE_DEFAULT).toBe(0.75);
        const general = SETTINGS_CATEGORIES.find((c) => c.name === "general")!.settings;
        expect(general.slice(1, 3)).toEqual([POINTING_GLOSS_SETTING, POINTING_SPARKLE_SETTING]);
    });

    it("gloss and sparkle blend smoothly and clamp", () => {
        expect(coatAt("silver", 0.4).coat).toBeCloseTo(0.08);
        expect(coatAt("red", 1).coat).toBeCloseTo(1);
        expect(coatAt("silver", 5)).toEqual(coatAt("silver", 1));
        expect(spkAt("silver", 0.25)!.F).toEqual([182, 104, 64]);
        expect(spkAt("silver", 1)!.F).toEqual([182, 150, 120]);
        spkAt("black", SPARKLE_DEFAULT)!.cov.forEach((v, i) => expect(v).toBeCloseTo([0.4, 0.85, 0.5][i]));
        expect(spkAt("pearl_blue", 0.5)).toBeNull();
    });

    it("has the seven balls of the design, 44 mm and 52 mm", () => {
        expect(MAT_ORDER).toEqual(["silver", "red", "black", "pearl_blue", "pearl_purple", "pearl_white", "pearl_black"]);
        expect(MAT_ORDER.map((b) => BALLS[b].mm)).toEqual([44, 44, 44, 52, 52, 52, 52]);
    });
});

describe("true-size placement", () => {
    it("puts each device in the free space beside the thumbs, clear of every key", () => {
        const keys = demoKeys();
        for (const side of ["left", "right"] as const) {
            const fc = freeCircle(keys, side)!;
            expect(fc.r).toBeGreaterThan(1.5);
            expect(keys.some((k) => overlaps(k, fc.cx, fc.cy, fc.r))).toBe(false);
            expect(side === "left" ? fc.cx < 12.5 : fc.cx > 12.5).toBe(true);
            const ball = placeDevice(keys, side, "ball", "silver")!;
            expect(ball.dU).toBeCloseTo(Math.min(44 / MM_PER_U, fc.r * 2));
            const pad = placeDevice(keys, side, "pad")!;
            expect(pad.w! / pad.h!).toBeCloseTo(43 / 40);
            expect(pad.h!).toBeLessThanOrEqual(40 / MM_PER_U + 1e-9);
        }
    });

    it("pearls are 52 mm, never larger than the free space", () => {
        const keys = demoKeys();
        const pearl = placeDevice(keys, "right", "ball", "pearl_blue")!;
        const silver = placeDevice(keys, "right", "ball", "silver")!;
        expect(pearl.dU).toBeGreaterThanOrEqual(silver.dU);
        expect(pearl.dU / 2).toBeLessThanOrEqual(freeCircle(keys, "right")!.r + 1e-9);
    });

    it("follows the finger-cluster squeeze as the keys are drawn", () => {
        const keys: KeyRect[] = [{ x: 1, y: 1, w: 1, h: 1 }, { x: 20, y: 1, w: 1, h: 1 }, { x: 8, y: 6, w: 1, h: 1 }];
        const placed = placedKeyRects(keys, { getYPos: (y) => y, squeeze: 0.5, midline: 12, offsetX: 0, offsetY: 0 });
        expect(placed.map((k) => k.x)).toEqual([1, 19, 7.5]);
    });
});

describe("pills and multiplier", () => {
    it("reads the factor from the keymap's sniper and boost keys", () => {
        expect(pointingFactors([[QK_USER_0 + 13]])).toEqual({ sniperDivisor: 3, boostFactor: 2 });
        expect(pointingFactors([[QK_USER_0 + 12, 4], [QK_USER_0 + 21]])).toEqual({ sniperDivisor: 2, boostFactor: 2 });
        expect(pointingFactors([[QK_USER_0 + 14, QK_USER_0 + 25]])).toEqual({ sniperDivisor: 5, boostFactor: 3 });
        // two different sniper factors: the default
        expect(pointingFactors([[QK_USER_0 + 12, QK_USER_0 + 14]]).sniperDivisor).toBe(3);
        expect(pointingFactors(undefined)).toEqual({ sniperDivisor: 3, boostFactor: 2 });
    });

    it("labels the pills ×0.33 and ×2 by default", () => {
        expect(sniperLabel(3)).toBe("×0.33");
        expect(sniperLabel(2)).toBe("×0.5");
        expect(sniperLabel(5)).toBe("×0.2");
        expect(boostLabel(2)).toBe("×2");
        const f = pointingFactors([]);
        expect(multiplierLabels({ sniper: true, boost: false }, f)).toEqual(["×0.33"]);
        expect(multiplierLabels({ sniper: true, boost: true }, f)).toEqual(["×0.33", "×2"]);
        expect(multiplierLabels({ sniper: false, boost: false }, f)).toEqual([]);
    });
});

describe("POINTING_MOTION (0x2D)", () => {
    const reply = (mode = 0, left?: [number, number, number], right?: [number, number, number]) => {
        const buf = new Uint8Array(32), view = new DataView(buf.buffer);
        buf[0] = 0x2d; buf[1] = 1; buf[2] = mode; buf[3] = 16;
        if (left) { buf[4] = left[0]; view.setInt16(5, left[1], true); view.setInt16(7, left[2], true); }
        if (right) { buf[14] = right[0]; view.setInt16(15, right[1], true); view.setInt16(17, right[2], true); }
        return buf;
    };
    it("is advertised by the second feature byte, bit 3", () => expect(SVIL_FLAG2_POINTING_MOTION).toBe(0x08));
    it("decodes sniper, boost and signed motion per hand", () => {
        const r = parsePointingMotion(reply(0b11, [1, -5, 7], [1, 300, -2]))!;
        expect(r).toMatchObject({ sniper: true, boost: true, elapsedMs: 16 });
        expect(r.left).toMatchObject({ valid: true, dx: -5, dy: 7 });
        expect(r.right).toMatchObject({ valid: true, dx: 300, dy: -2 });
        expect(parsePointingMotion(reply().slice(0, 25))).toBeNull();
        const noData = reply(); noData[1] = 0;
        expect(parsePointingMotion(noData)).toBeNull();
    });
});

describe("review params", () => {
    it("?demo=pointing loads a left touchpad and a right trackball, moving, sniper as asked", () => {
        expect(pointingDemoFromSearch("?demo=pointing&sniper=1")).toMatchObject({ demo: true, left: "touchpad", right: "trackball", sniper: true, boost: false, hand: "right", motion: true });
        expect(pointingDemoFromSearch("?demo=pointing&left=trackball&right=none&hand=left&boost=1")).toMatchObject({ left: "trackball", right: "none", hand: "left", boost: true });
        expect(pointingDemoFromSearch("?demo=combos")).toBeNull();
        expect(pointingDemoFromSearch("")).toBeNull();
        expect(pointingDemoFromSearch("?sniper=1")).toMatchObject({ demo: false, sniper: true, left: undefined, motion: false });
        expect(pointingDemoFromSearch("?demo=pointing&panel=fragments")!.panel).toBe("fragments");
    });

    it("the demo script reports counts for the moving hand only", () => {
        const d = pointingDemoFromSearch("?demo=pointing&sniper=1")!;
        let moved = 0;
        for (let t = 0; t < 6; t += 0.1) {
            const r = demoReport(d, t, t + 0.1);
            expect(r.sniper).toBe(true);
            expect(r.left.dx).toBe(0);
            moved += Math.abs(r.right.dx) + Math.abs(r.right.dy);
        }
        expect(moved).toBeGreaterThan(0);
    });
});

describe("renderer without WebGL", () => {
    beforeEach(() => _setWebGLDisabledForTest(true));
    afterEach(() => _setWebGLDisabledForTest(false));

    it("draws a still stand-in and says nothing", () => {
        expect(webglAvailable()).toBe(false);
        const calls: string[] = [];
        const ctx = new Proxy({}, {
            get: (_t, k) => (k === "createRadialGradient" ? () => ({ addColorStop: () => {} }) : typeof k === "string" ? (..._a: unknown[]) => { calls.push(k); } : undefined),
            set: () => true,
        }) as unknown as CanvasRenderingContext2D;
        const canvas = { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
        const drewPhysical = drawDevice(canvas, 100, { kind: "ball", mat: "pearl_blue", M: rotFromEuler(0, 0, 0), view: 1.24, gloss: 0.25, sparkle: 0.75 }, "light");
        expect(drewPhysical).toBe(false);
        expect(calls).toContain("arc");
        expect(calls).toContain("fill");
        expect(canvas.width).toBe(100);
    });
});
