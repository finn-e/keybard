import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SETTINGS, SETTINGS_CATEGORIES } from "@/contexts/SettingsContext";
import { BALL_GLOSS, BALL_SPARKLE, BALLS, bodyAt, coatAt, LIGHTNESS_DEFAULT, MAT_ORDER, SPARKLE_DEFAULT, spkAt } from "@/components/pointing-viz/webgl/materials";
import { _setWebGLDisabledForTest, drawDevice, rotFromEuler, unpremultiplyFlipped, webglAvailable } from "@/components/pointing-viz/webgl/renderer";
import { demoReport, pointingDemoFromSearch } from "@/features/pointing-demo";
import { freeCircle, MM_PER_U, placeDevice, placedKeyRects, type KeyRect } from "@/utils/pointing-geometry";
import { boostLabel, multiplierLabels, pointingFactors, sniperLabel } from "@/utils/pointing-multiplier";
import { KEYBARD_MOTION_READER, parsePointingMotion, SVIL_FLAG2_POINTING_MOTION, SVIL_FLAG2_POINTING_MOTION_READERS } from "@/utils/pointing-motion";

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
    it("Ball gloss is fixed at 1 and sparkle at its default, with no sliders", () => {
        expect(BALL_GLOSS).toBe(1);
        expect(BALL_SPARKLE).toBe(SPARKLE_DEFAULT);
        expect(SPARKLE_DEFAULT).toBe(0.75);
        for (const name of ["pointing-ball-gloss", "pointing-sparkle"]) {
            expect(SETTINGS.find((s) => s.name === name)).toBeUndefined();
            for (const c of SETTINGS_CATEGORIES) expect(c.settings).not.toContain(name);
        }
        expect(SETTINGS.some((s) => s.type === "slider")).toBe(false);
    });

    it("Ball lightness is fixed per ball: silver at 1, the others as designed, and no slider", () => {
        expect(SETTINGS.find((s) => s.name === "pointing-ball-lightness")).toBeUndefined();
        expect(BALLS.silver).toMatchObject({ light: 1 });
        for (const id of MAT_ORDER) if (id !== "silver") expect((BALLS[id] as { light?: number }).light).toBeUndefined();
    });

    it("Ball lightness leaves the body color alone at the default and moves it lighter or darker", () => {
        const c = [0.6, 0.3, 0.1];
        expect(bodyAt(c, LIGHTNESS_DEFAULT)).toEqual(c);
        expect(bodyAt(c, undefined)).toEqual(c);
        const up = bodyAt(c, 1), down = bodyAt(c, 0);
        up.forEach((v, i) => { expect(v).toBeGreaterThan(c[i]); expect(v).toBeLessThan(1); });
        down.forEach((v, i) => { expect(v).toBeLessThan(c[i]); expect(v).toBeGreaterThan(0); });
        expect(bodyAt(c, 7)).toEqual(up);
        expect(bodyAt(c, -3)).toEqual(down);
        // monotonic across the range
        let prev = -1;
        for (let l = 0; l <= 1.0001; l += 0.05) { const v = bodyAt(c, l)[0]; expect(v).toBeGreaterThanOrEqual(prev); prev = v; }
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
    it("per-reader counts are advertised by bit 4; Keybard reads as reader 1", () => {
        expect(SVIL_FLAG2_POINTING_MOTION_READERS).toBe(0x10);
        expect(KEYBARD_MOTION_READER).toBe(1);
    });
    it("reads each hand's CPI from the extension, when the board reports one", () => {
        const buf = new Uint8Array(64); buf.set(reply(0, [1, 10, 0], [1, 0, 0]));
        const view = new DataView(buf.buffer);
        buf[25] = 1; view.setUint16(26, 1600, true); view.setUint16(28, 0, true);
        const r = parsePointingMotion(buf)!;
        expect(r.left.cpi).toBe(1600);
        expect(r.right.cpi).toBeUndefined(); // 0: no CPI-based sensor
        expect(parsePointingMotion(reply(0, [1, 1, 1]).slice(0, 26))!.left.cpi).toBeUndefined(); // 32-byte wrapped reply
        expect(parsePointingMotion(new Uint8Array(64).fill(0).map((_, i) => (i === 0 ? 0x2d : i === 1 ? 1 : 0)))!.left.cpi).toBeUndefined(); // older firmware: zeros
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

describe("pointing renderer readback (Keybard Host's software-composited overlay)", () => {
    it("turns WebGL's bottom-up premultiplied rows into top-down straight-alpha ImageData", () => {
        // 1 px wide, 2 rows: GL row 0 is the bottom one.
        const src = new Uint8Array([
            100, 50, 0, 128, // bottom: half-covered orange, premultiplied
            10, 20, 30, 255, // top: opaque
        ]);
        const px = 1;
        // A 1x1 device would only read one row; use a 2x2 to check the flip on a square.
        const sq = new Uint8Array([...src.slice(0, 4), ...src.slice(0, 4), ...src.slice(4), ...src.slice(4)]);
        const dst = new Uint8ClampedArray(16);
        unpremultiplyFlipped(sq, dst, 2);
        expect(Array.from(dst.slice(0, 4))).toEqual([10, 20, 30, 255]);
        expect(Array.from(dst.slice(8, 12))).toEqual([199, 100, 0, 128]);
        const clear = new Uint8ClampedArray(4);
        unpremultiplyFlipped(new Uint8Array([0, 0, 0, 0]), clear, px);
        expect(Array.from(clear)).toEqual([0, 0, 0, 0]);
    });
});
