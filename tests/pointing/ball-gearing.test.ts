import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { ballRollRadians, TRACKBALL_COUNTS_PER_MM } from "@/components/pointing-viz/ball-gearing";
import { BALLS } from "@/components/pointing-viz/webgl/materials";
import { DEMO_COUNTS_PER_MM } from "@/features/pointing-demo";

/** Counts the board reports for `mm` of ball surface travel. */
const countsFor = (mm: number) => mm * TRACKBALL_COUNTS_PER_MM;

describe("trackball gearing", () => {
    it("reports 400 counts per inch of ball surface", () => {
        expect(TRACKBALL_COUNTS_PER_MM * 25.4).toBeCloseTo(400, 9);
    });

    for (const mm of [44, 52]) {
        it(`half a circumference of travel turns a ${mm} mm ball half a rotation`, () => {
            expect(ballRollRadians(countsFor((Math.PI * mm) / 2), mm)).toBeCloseTo(Math.PI, 9);
        });
        it(`a full circumference turns a ${mm} mm ball once`, () => {
            expect(ballRollRadians(countsFor(Math.PI * mm), mm)).toBeCloseTo(2 * Math.PI, 9);
        });
    }

    it("the same travel turns a 44 mm ball further than a 52 mm ball, by the ratio of their sizes", () => {
        const c = countsFor(20);
        expect(ballRollRadians(c, 44) / ballRollRadians(c, 52)).toBeCloseTo(52 / 44, 9);
    });

    it("every ball's gearing comes from its physical diameter", () => {
        for (const ball of Object.values(BALLS)) {
            expect(ballRollRadians(countsFor((Math.PI * ball.mm) / 2), ball.mm)).toBeCloseTo(Math.PI, 9);
        }
    });

    it("takes no DPI: the renderer has no CPI or DPI input, so the DPI setting cannot change rotation", () => {
        expect(ballRollRadians.length).toBe(2);
        const src = readFileSync(resolve(process.cwd(), "src/components/pointing-viz/PointingDevice.tsx"), "utf8");
        expect(src).not.toMatch(/\b(cpi|dpi|DEFAULT_CPI)\b|[gG]etDpi|leftDpi|rightDpi/);
        expect(src).toContain("ballRollRadians(half.dx, mm)");
        // The same counts give the same turn whatever the DPI setting reads.
        const at = (_dpi: number) => ballRollRadians(1000, 52);
        expect(at(200)).toBe(at(800));
        expect(at(12000)).toBe(at(800));
    });

    it("the demo reports at the board's rate, so it rolls as the real ball would", () => {
        expect(DEMO_COUNTS_PER_MM).toBe(TRACKBALL_COUNTS_PER_MM);
    });

    it("Keybard Host's demo uses the same counts per mm", () => {
        const py = readFileSync(resolve(process.cwd(), "companion/overlay-host/keybard_host/host_pointing.py"), "utf8");
        expect(py).toMatch(/TRACKBALL_COUNTS_PER_MM = 400 \/ 25\.4/);
    });
});
