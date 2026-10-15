import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { ballRollRadians, countsToMm, DEFAULT_TRACKBALL_CPI } from "@/components/pointing-viz/ball-gearing";
import { BALLS } from "@/components/pointing-viz/webgl/materials";
import { DEMO_COUNTS_PER_MM } from "@/features/pointing-demo";
import { hostPointingEvent } from "@/features/trainer/host-pointing";

/** Counts a sensor at `cpi` reports for `mm` of ball surface travel. */
const countsFor = (mm: number, cpi: number) => (mm * cpi) / 25.4;

describe("trackball gearing at the board's CPI", () => {
    it("turns counts into mm of surface at the reported CPI", () => {
        expect(countsToMm(800, 800)).toBeCloseTo(25.4, 9);
        expect(countsToMm(1600, 1600)).toBeCloseTo(25.4, 9);
        expect(countsToMm(400, 1600)).toBeCloseTo(6.35, 9);
    });

    for (const cpi of [200, 800, 1600, 3200]) {
        for (const mm of [44, 52]) {
            it(`half a circumference at ${cpi} CPI turns a ${mm} mm ball half a rotation`, () => {
                expect(ballRollRadians(countsFor((Math.PI * mm) / 2, cpi), mm, cpi)).toBeCloseTo(Math.PI, 9);
            });
        }
    }

    it("the same travel turns the ball the same at any CPI", () => {
        const travel = 30;
        const turns = [400, 800, 1200, 6400].map((cpi) => ballRollRadians(countsFor(travel, cpi), 52, cpi));
        for (const t of turns) expect(t).toBeCloseTo(turns[0], 9);
    });

    it("the same travel turns a 44 mm ball further than a 52 mm ball, by the ratio of their sizes", () => {
        const c = countsFor(20, 1600);
        expect(ballRollRadians(c, 44, 1600) / ballRollRadians(c, 52, 1600)).toBeCloseTo(52 / 44, 9);
    });

    it("every ball's gearing comes from its physical diameter", () => {
        for (const ball of Object.values(BALLS)) {
            expect(ballRollRadians(countsFor((Math.PI * ball.mm) / 2, 1200), ball.mm, 1200)).toBeCloseTo(Math.PI, 9);
        }
    });

    it("the renderer gears each hand by the CPI in its report", () => {
        const src = readFileSync(resolve(process.cwd(), "src/components/pointing-viz/PointingDevice.tsx"), "utf8");
        expect(src).toContain("ballRollRadians(half.dx, mm, half.cpi)");
        expect(src).toContain("ballRollRadians(half.dy, mm, half.cpi)");
    });
});

describe("trackball gearing on older firmware (no CPI reported)", () => {
    it("assumes the firmware's default CPI, 800", () => {
        expect(DEFAULT_TRACKBALL_CPI).toBe(800);
        expect(ballRollRadians(1000, 52)).toBe(ballRollRadians(1000, 52, 800));
        expect(ballRollRadians(1000, 52, 0)).toBe(ballRollRadians(1000, 52, 800));
        expect(ballRollRadians(countsFor(Math.PI * 52, 800), 52)).toBeCloseTo(2 * Math.PI, 9);
    });

    it("no fixed 400 counts per inch is left", () => {
        const src = readFileSync(resolve(process.cwd(), "src/components/pointing-viz/ball-gearing.ts"), "utf8");
        expect(src).not.toMatch(/\b400\b/);
    });

    it("the demo reports at the default CPI and no CPI, so it rolls as a default board would", () => {
        expect(DEMO_COUNTS_PER_MM).toBeCloseTo(DEFAULT_TRACKBALL_CPI / 25.4, 12);
    });

    it("Keybard Host's demo uses the same default", () => {
        const py = readFileSync(resolve(process.cwd(), "companion/overlay-host/keybard_host/host_pointing.py"), "utf8");
        expect(py).toMatch(/DEFAULT_TRACKBALL_CPI = 800\b/);
        expect(py).toMatch(/TRACKBALL_COUNTS_PER_MM = DEFAULT_TRACKBALL_CPI \/ 25\.4/);
    });
});

describe("Keybard Host motion events", () => {
    it("carry each hand's CPI when the board reports it", () => {
        const r = hostPointingEvent({ left: { valid: true, dx: 5, cpi: 1600 }, right: { valid: true, dx: 1 } })!;
        expect(r.left.cpi).toBe(1600);
        expect(r.right.cpi).toBeUndefined();
        expect(hostPointingEvent({ left: { cpi: 0 }, right: { cpi: "x" } })!.left.cpi).toBeUndefined();
    });
});
