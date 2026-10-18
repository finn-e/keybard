// Velocity Scroll in Keybard: the 0x2D block, the curve, where it shows, the
// drawing's scales, the demo, and the Overlay's relay.
import { afterEach, describe, expect, it, vi } from "vitest";

import { drawPills, PILL_LABEL } from "@/components/pointing-viz/overlay-draw";
import {
    DEFAULT_VELOCITY_VIZ, drawVelocity, speedReach, speedTip, velocityHere, velocityScale, velocityVizFromSearch, VELOCITY_VIZ,
} from "@/components/pointing-viz/velocity-draw";
import { demoReport, pointingDemoFromSearch, velocityPath, _resetPointingDemoForTests } from "@/features/pointing-demo";
import { hostPointingEvent } from "@/features/trainer/host-pointing";
import { PointingLiveService } from "@/services/pointing-live.service";
import { parsePointingMotion, type PointingMotionReport } from "@/utils/pointing-motion";
import {
    parseVelocityScroll, VELOCITY_DEFAULTS, velocityFullMm, velocityOffsetFor, velocityScrollFromJson, velocitySpeed, velocityStateFor,
} from "@/utils/velocity-scroll";

/** A 0x2D reply on a 64-byte report (command echo first), with the block when given. */
function reply(block?: { flags: number; ox: number; oy: number; sh: number; sv: number }) {
    const buf = new Uint8Array(2 + 57), view = new DataView(buf.buffer);
    buf[0] = 0x2d; buf[1] = 1; buf[4] = 1; // format 1, left hand valid
    if (block) {
        const o = 1 + 29;
        buf[o] = 0x56; buf[o + 1] = block.flags;
        [block.ox, block.oy, block.sh, block.sv].forEach((v, i) => view.setInt16(o + 2 + i * 2, v, true));
        [6000, 80, 1200, 1500, 150, 1600, 1500].forEach((v, i) => view.setUint16(o + 10 + i * 2, v, true));
    }
    return buf;
}

describe("the Velocity Scroll block in POINTING_MOTION", () => {
    it("decodes held, the pad, the offset, the speed and both curves", () => {
        const r = parsePointingMotion(reply({ flags: 0x01 | 0x02 | 0x04 | (2 << 4) | 0x08, ox: -326, oy: 1250, sh: 0, sv: -1734 }))!;
        const v = r.velocityScroll!;
        expect(v.held).toBe(true);
        expect(v.padHand).toBe("right");
        expect(v.axisLock).toBe(true);
        expect(v.lockedAxis).toBe("horizontal");
        expect(v.offsetMm).toEqual({ x: -3.26, y: 12.5 });
        expect(v.speedNps).toEqual({ h: 0, v: -17.34 });
        expect(v.ball).toEqual({ deadMm: 0.8, gain: 12, exponent: 1.5, maxNps: 60 });
        expect(v.pad).toEqual({ deadMm: 1.5, gain: 16, exponent: 1.5, maxNps: 60 });
    });

    it("a left pad, or no finger (the relative pointers)", () => {
        expect(parsePointingMotion(reply({ flags: 0x03, ox: 0, oy: 0, sh: 0, sv: 0 }))!.velocityScroll!.padHand).toBe("left");
        expect(parsePointingMotion(reply({ flags: 0x01, ox: 0, oy: 0, sh: 0, sv: 0 }))!.velocityScroll!.padHand).toBeNull();
        expect(parsePointingMotion(reply({ flags: 0x00, ox: 0, oy: 0, sh: 0, sv: 0 }))!.velocityScroll!.held).toBe(false);
    });

    it("is absent on firmware without it (zeros) and in short replies, so no pill shows", () => {
        expect(parsePointingMotion(reply())!.velocityScroll).toBeUndefined();
        expect(parsePointingMotion(reply({ flags: 1, ox: 0, oy: 0, sh: 0, sv: 0 }).slice(0, 2 + 29))!.velocityScroll).toBeUndefined();
        expect("velocityScroll" in parsePointingMotion(reply())!).toBe(false);
        const short = reply({ flags: 1, ox: 0, oy: 0, sh: 0, sv: 0 }).slice(0, 1 + 52);
        expect(parseVelocityScroll(new DataView(short.buffer, short.byteOffset, short.byteLength), 1)).toBeUndefined();
    });
});

describe("the curve, as the firmware computes it", () => {
    const c = VELOCITY_DEFAULTS.ball;
    it("is zero inside the dead zone and signed outside it", () => {
        expect(velocitySpeed(c, 0.5)).toBe(0);
        expect(velocitySpeed(c, -0.8)).toBe(0);
        expect(velocitySpeed(c, 10.8)).toBeCloseTo(12, 6); // gain at 10 mm past the dead zone
        expect(velocitySpeed(c, -10.8)).toBeCloseTo(-12, 6);
        expect(velocitySpeed(c, 200)).toBe(60);
    });
    it("reaches the cap at the full offset, and inverts", () => {
        const full = velocityFullMm(c);
        expect(velocitySpeed(c, full)).toBeCloseTo(60, 4);
        expect(velocitySpeed(c, full - 1)).toBeLessThan(60);
        expect(velocityOffsetFor(c, 30)).toBeCloseTo(c.deadMm + 10 * Math.pow(30 / 12, 1 / 1.5), 6);
        expect(velocitySpeed(c, velocityOffsetFor(c, 30))).toBeCloseTo(30, 6);
    });
    it("a held state for an offset: toward the user scrolls down", () => {
        const s = velocityStateFor({ x: 0.3, y: 12 }, null);
        expect(s.speedNps.h).toBe(0);
        expect(s.speedNps.v).toBeCloseTo(-velocitySpeed(c, 12), 6);
        expect(velocityStateFor({ x: 4, y: 0 }, "left").speedNps.h).toBeCloseTo(velocitySpeed(VELOCITY_DEFAULTS.pad, 4), 6);
    });
});

describe("where it shows", () => {
    const vs = (padHand: "left" | "right" | null) => velocityStateFor({ x: 0, y: 5 }, padHand);
    const at = (kind: "ball" | "pad", side: "left" | "right", showModes: boolean, otherKind: "ball" | "pad" | null) =>
        ({ placement: { kind, side }, showModes, otherKind });
    it("the pad whose finger sets the offset, and no other hand", () => {
        expect(velocityHere(at("pad", "left", false, "ball"), vs("left"))).toBe(true);
        expect(velocityHere(at("ball", "right", true, "pad"), vs("left"))).toBe(false);
    });
    it("else the trackball; with two, the moving one", () => {
        expect(velocityHere(at("ball", "right", false, "pad"), vs(null))).toBe(true);
        expect(velocityHere(at("pad", "left", true, "ball"), vs(null))).toBe(false);
        expect(velocityHere(at("ball", "left", false, "ball"), vs(null))).toBe(false);
        expect(velocityHere(at("ball", "right", true, "ball"), vs(null))).toBe(true);
    });
    it("a lone pad with no finger down yet shows it at the moving hand", () => {
        expect(velocityHere(at("pad", "right", true, null), vs(null))).toBe(true);
        expect(velocityHere(at("pad", "right", true, "pad"), vs(null))).toBe(true);
        expect(velocityHere(at("pad", "left", false, "pad"), vs(null))).toBe(false);
    });
    it("nothing without a state", () => expect(velocityHere(at("ball", "right", true, null), null)).toBe(false));
});

describe("the drawing's scales", () => {
    it("touchpad: true size, so the offset line ends under the finger", () => {
        const s = velocityScale("pad", VELOCITY_DEFAULTS.pad, 0, 4);
        expect(s(10)).toBe(40);
        expect(s(-2.5)).toBe(-10);
        expect(speedReach(VELOCITY_DEFAULTS.pad, s)).toBeCloseTo(velocityFullMm(VELOCITY_DEFAULTS.pad) * 4, 6);
    });
    it("trackball: a square-root field with full speed at the rim, so the dead zone stays visible", () => {
        const c = VELOCITY_DEFAULTS.ball, s = velocityScale("ball", c, 50, 0);
        expect(s(velocityFullMm(c))).toBeCloseTo(50, 6);
        expect(s(1000)).toBe(50); // clamped where the firmware clamps
        expect(Math.abs(s(-c.deadMm))).toBeGreaterThan(7); // 0.8 mm is still ~8 px
        expect(s(-4)).toBeLessThan(0);
    });
    it("the speed arrow: share of the maximum along each axis, up on screen for +v", () => {
        const st = { ...velocityStateFor({ x: 0, y: 0 }, null), speedNps: { h: 30, v: 15 } };
        expect(speedTip(st, VELOCITY_DEFAULTS.ball, 100)).toEqual({ x: 50, y: -25 });
        const fast = { ...st, speedNps: { h: -600, v: 0 } };
        expect(speedTip(fast, VELOCITY_DEFAULTS.ball, 100).x).toBe(-100);
    });
});

/** A canvas context that records calls, for drawing smoke tests. */
function fakeCtx() {
    const calls: string[] = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
        get(target, key: string) {
            if (key in target) return target[key];
            if (key === "measureText") return (t: string) => ({ width: t.length * 6 });
            return (...args: unknown[]) => { calls.push(`${key}(${args.length})`); };
        },
        set(target, key: string, value) { target[key] = value; return true; },
    });
    return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

describe("the look", () => {
    it("is picked by ?velViz=, field by default", () => {
        expect(DEFAULT_VELOCITY_VIZ).toBe("field");
        expect(VELOCITY_VIZ).toEqual(["field", "curve", "rim"]);
        expect(velocityVizFromSearch("?velViz=rim")).toBe("rim");
        expect(velocityVizFromSearch("?velViz=CURVE")).toBe("curve");
        expect(velocityVizFromSearch("?velViz=nope")).toBe("field");
        expect(velocityVizFromSearch("")).toBe("field");
    });
    it("every look draws, on a ball and on a pad, and nothing once it has faded", () => {
        const st = velocityStateFor({ x: 2, y: 9 }, "left");
        for (const viz of VELOCITY_VIZ) {
            for (const kind of ["ball", "pad"] as const) {
                const { ctx, calls } = fakeCtx();
                drawVelocity(ctx, st, { viz, kind, side: "left", amount: 1, anchor: { x: 3, y: -4 }, reach: 60, pxPerMm: 4, unitPx: 50, k: 2,
                    colors: { accent: "#099e7c", card: "#000", cardFg: "#fff" }, fontPx: 11, bottom: 60 });
                expect(calls.some((c) => c.startsWith("arc"))).toBe(true);
            }
        }
        const { ctx, calls } = fakeCtx();
        drawVelocity(ctx, st, { viz: "field", kind: "ball", side: "left", amount: 0, anchor: { x: 0, y: 0 }, reach: 60, pxPerMm: 4, unitPx: 50, k: 2,
            colors: { accent: "#099e7c", card: "#000", cardFg: "#fff" }, fontPx: 11, bottom: 60 });
        expect(calls).toEqual([]);
    });
    it("the pill reads VEL SCROLL, with no multiplier", () => {
        expect(PILL_LABEL.velocity).toBe("VEL SCROLL");
        const { ctx, calls } = fakeCtx();
        const texts: string[] = [];
        (ctx as unknown as { fillText: (t: string) => void }).fillText = (t: string) => { texts.push(t); };
        drawPills(ctx, [{ kind: "velocity", amount: 1, mult: "" }], { side: "right", r: 50, unitPx: 50, centered: false, host: false, colors: { bg: "#000", fg: "#fff" } });
        expect(texts).toEqual(["VEL SCROLL"]);
        expect(calls.length).toBeGreaterThan(0);
    });
});

describe("the demo", () => {
    afterEach(() => _resetPointingDemoForTests());
    it("&velocity=1 holds Velocity Scroll at the moving hand, already away from the anchor", () => {
        const d = pointingDemoFromSearch("?demo=pointing&velocity=1")!;
        expect(d.velocity).toBe(true);
        const r = demoReport(d, 0, 1 / 60);
        expect(r.velocityScroll!.held).toBe(true);
        expect(r.velocityScroll!.padHand).toBeNull(); // the right hand is the trackball
        expect(Math.hypot(r.velocityScroll!.offsetMm.x, r.velocityScroll!.offsetMm.y)).toBeGreaterThan(10);
        expect(r.velocityScroll!.speedNps.v).toBeLessThan(0);
    });
    it("on the touchpad the finger sits at the anchor plus the offset, and the pad is named", () => {
        const d = pointingDemoFromSearch("?demo=pointing&velocity=1&hand=left&motion=0")!;
        const a = demoReport(d, 0, 1 / 60), b = demoReport(d, 1, 1 + 1 / 60);
        expect(a.velocityScroll!.padHand).toBe("left");
        expect(a.left.touchValid).toBe(true);
        expect([b.left.touchX, b.left.touchY]).toEqual([a.left.touchX, a.left.touchY]); // still with motion off
        expect(a.velocityScroll!.offsetMm).toEqual(velocityPath(0, "touchpad", false));
    });
    it("the trackball rolls by the offset's change", () => {
        const d = pointingDemoFromSearch("?demo=pointing&velocity=1")!;
        const r = demoReport(d, 2, 2.1);
        const dy = velocityPath(2.1, "trackball", true).y - velocityPath(2, "trackball", true).y;
        expect(Math.sign(r.right.dy)).toBe(Math.sign(dy));
    });
    it("without &velocity there is no state", () => {
        expect(demoReport(pointingDemoFromSearch("?demo=pointing")!, 0, 0.016).velocityScroll).toBeUndefined();
    });
});

describe("the Overlay's relay", () => {
    const state = velocityStateFor({ x: 1, y: -6 }, "right");
    it("passes a valid state through to the drawing", () => {
        const r = hostPointingEvent({ left: { valid: true }, right: { valid: true }, velocityScroll: state })!;
        expect(r.velocityScroll).toEqual(state);
    });
    it("drops a malformed one, and older Overlays send none", () => {
        expect(hostPointingEvent({ left: {}, right: {}, velocityScroll: { held: true } })!.velocityScroll).toBeUndefined();
        expect(velocityScrollFromJson({ ...state, ball: { ...state.ball, gain: Number.NaN } })).toBeUndefined();
        expect(velocityScrollFromJson({ ...state, pad: { ...state.pad, deadMm: -1 } })).toBeUndefined();
        expect(hostPointingEvent({ left: {}, right: {} })!.velocityScroll).toBeUndefined();
    });
});

describe("polling while held", () => {
    it("keeps the fast rate while Velocity Scroll is held, though the pointer rests", async () => {
        vi.useFakeTimers();
        try {
            const still: PointingMotionReport = { ...demoReport(pointingDemoFromSearch("?demo=pointing&velocity=1&motion=0")!, 0, 0.016) };
            still.right = { ...still.right, dx: 0, dy: 0 };
            const live = new PointingLiveService({ getPointingMotion: async () => still, hasPointingMotion: () => true, now: () => Date.now() });
            live.setConnection({} as never, true, 1);
            const reads: number[] = [];
            live.subscribe(() => reads.push(Date.now()));
            const release = live.acquire();
            await vi.advanceTimersByTimeAsync(2000);
            release();
            // 30 quiet reads would drop it to 100 ms; held, it stays near 16 ms.
            expect(reads.length).toBeGreaterThan(60);
        } finally {
            vi.useRealTimers();
        }
    });
});
