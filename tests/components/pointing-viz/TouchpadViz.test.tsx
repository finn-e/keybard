import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
    TouchpadViz,
    _testCreateState,
    _testDotRadius,
    _testDraw,
    _testChevronSlots,
    _testFingerTargets,
    _testHaloScale,
    _testIngest,
    _testIsActive,
    _testNeedsAnimation,
    _testPadRect,
    _testRipple,
    _testScrollAxis,
    _testScrollRate,
    _testSnap,
    _testStep,
    _testStreakTaper,
    _testTrailLiveCount,
    _testTrailMs,
    _testTrailPush,
} from "@/components/pointing-viz/TouchpadViz";
import { simulateSample } from "@/components/pointing-viz/simulate";
import {
    DEFAULT_POINTING_VIZ_THEME,
    POINTING_IDLE_MS,
    type PointingLiveSample,
    type PointingMode,
    type PointingSampleSource,
} from "@/components/pointing-viz/types";

function fakeSource(sample: PointingLiveSample | null) {
    const listeners = new Set<(s: PointingLiveSample) => void>();
    const unsubscribe = vi.fn();
    let latest = sample;
    const source: PointingSampleSource = {
        latest: () => latest,
        subscribe: (l) => {
            listeners.add(l);
            return () => {
                listeners.delete(l);
                unsubscribe();
            };
        },
    };
    return {
        source,
        unsubscribe,
        emit(s: PointingLiveSample) {
            latest = s;
            for (const l of listeners) l(s);
        },
    };
}

function sample(over: Partial<PointingLiveSample> = {}): PointingLiveSample {
    return {
        t: 1000,
        dtMs: 33,
        dx: 0,
        dy: 0,
        h: 0,
        v: 0,
        buttons: 0,
        mode: "pointer",
        scrolling: false,
        precision: false,
        boost: false,
        axisLock: "free",
        naturalScroll: false,
        autoMouseLayer: false,
        saturated: false,
        ...over,
    };
}

/** Runs the step function at 60 fps over the simulator for `ms`. */
function runSim(mode: PointingMode | "idle", ms: number, useTouches = true) {
    const st = _testCreateState();
    for (let t = 0; t <= ms; t += 16) {
        const sampleT = Math.floor(t / 33) * 33;
        const s = simulateSample("touchpad", "left", sampleT, { mode });
        if (!useTouches) {
            delete s.touches;
            delete s.fingers;
        }
        _testStep(st, s, t, 16);
    }
    return st;
}

describe("TouchpadViz component", () => {
    let rafSpy: ReturnType<typeof vi.spyOn>;
    let cafSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        rafSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 42);
        cafSpy = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
        // jsdom has no canvas: getContext returns null.
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    });
    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it("renders without throwing and labels side and module", () => {
        const { source } = fakeSource(simulateSample("touchpad", "right", 500));
        render(<TouchpadViz source={source} side="right" width={120} height={120} reducedMotion={false} theme={DEFAULT_POINTING_VIZ_THEME} />);
        const img = screen.getByRole("img");
        expect(img.getAttribute("aria-label")).toMatch(/Right/);
        expect(img.getAttribute("aria-label")).toMatch(/touchpad/i);
        expect(img.querySelector("canvas")?.getAttribute("aria-hidden")).toBe("true");
    });

    it("unsubscribes and cancels its animation frame on unmount", () => {
        const { source, unsubscribe } = fakeSource(sample({ t: performance.now(), dx: 20, dy: 5 }));
        const { unmount } = render(
            <TouchpadViz source={source} side="left" width={80} height={80} reducedMotion={false} theme={DEFAULT_POINTING_VIZ_THEME} />,
        );
        expect(rafSpy).toHaveBeenCalled();
        unmount();
        expect(unsubscribe).toHaveBeenCalledTimes(1);
        expect(cafSpy).toHaveBeenCalledWith(42);
    });

    it("schedules no animation frame under reduced motion, and redraws on samples", () => {
        vi.useFakeTimers();
        try {
            const fake = fakeSource(sample({ t: performance.now(), dx: 10 }));
            const { unmount } = render(
                <TouchpadViz source={fake.source} side="left" width={80} height={80} reducedMotion theme={DEFAULT_POINTING_VIZ_THEME} />,
            );
            fake.emit(sample({ t: performance.now() + 1, dx: -10 }));
            vi.advanceTimersByTime(300);
            expect(rafSpy).not.toHaveBeenCalled();
            unmount();
            expect(fake.unsubscribe).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it("does not start the loop for an idle source, and wakes on an active sample", () => {
        const fake = fakeSource(null);
        render(<TouchpadViz source={fake.source} side="left" width={80} height={80} reducedMotion={false} theme={DEFAULT_POINTING_VIZ_THEME} />);
        expect(rafSpy).not.toHaveBeenCalled();
        fake.emit(sample({ t: performance.now() }));
        expect(rafSpy).not.toHaveBeenCalled();
        fake.emit(sample({ t: performance.now() + 1, dx: 12 }));
        expect(rafSpy).toHaveBeenCalledTimes(1);
    });
});

describe("TouchpadViz geometry", () => {
    it("keeps the pad near square (1.15:1) inside square and wide areas", () => {
        for (const [w, h] of [[60, 60], [95, 95], [130, 130], [150, 95], [284, 284]]) {
            const p = _testPadRect(w, h);
            expect(p.w / p.h).toBeCloseTo(1.15, 5);
            expect(p.x).toBeGreaterThanOrEqual(0);
            expect(p.y).toBeGreaterThan(0);
            expect(p.x + p.w).toBeLessThanOrEqual(w);
            // Room below for the shadow.
            expect(h - (p.y + p.h)).toBeGreaterThanOrEqual(p.y - 1e-6);
            expect(p.dot).toBeGreaterThanOrEqual(2.5);
            expect(Math.abs(p.x + p.w / 2 - w / 2)).toBeLessThan(1e-6);
        }
        const small = _testPadRect(60, 60);
        const large = _testPadRect(120, 120);
        expect(large.dot).toBeCloseTo(small.dot * 2, 0);
    });

    it("sizes the dot per mode", () => {
        expect(_testDotRadius(4, "precision", 0)).toBeLessThan(_testDotRadius(4, "pointer", 0));
        expect(_testDotRadius(4, "boost", 0)).toBeGreaterThan(_testDotRadius(4, "pointer", 0));
        expect(_testDotRadius(4, "pointer", 1)).toBeGreaterThan(_testDotRadius(4, "pointer", 0));
    });

    it("spreads the glow per mode: tight in precision, widest in boost", () => {
        expect(_testHaloScale("precision", 1)).toBeLessThan(_testHaloScale("pointer", 0));
        expect(_testHaloScale("boost", 0)).toBeGreaterThan(_testHaloScale("pointer", 1));
        expect(_testHaloScale("pointer", 1)).toBeGreaterThan(_testHaloScale("pointer", 0));
    });

    it("tapers streaks from a point at the tail to full width at the head", () => {
        expect(_testStreakTaper(0)).toBe(0);
        expect(_testStreakTaper(1)).toBeCloseTo(1, 5);
        let prev = -1;
        for (let u = 0; u <= 1.0001; u += 0.1) {
            const v = _testStreakTaper(u);
            expect(v).toBeGreaterThan(prev);
            prev = v;
        }
        expect(_testStreakTaper(-1)).toBe(0);
        expect(_testStreakTaper(2)).toBeCloseTo(1, 5);
    });

    it("spreads the button ripple outward and fades it out", () => {
        const start = _testRipple(0, 4, 100);
        const mid = _testRipple(300, 4, 100);
        const late = _testRipple(600, 4, 100);
        expect(start.strength).toBeCloseTo(1, 5);
        expect(mid.radius).toBeGreaterThan(start.radius);
        expect(late.radius).toBeGreaterThan(mid.radius);
        expect(late.radius).toBeLessThanOrEqual(4 * 1.1 + 100);
        expect(mid.strength).toBeLessThan(start.strength);
        expect(late.strength).toBeLessThan(mid.strength);
        expect(_testRipple(650, 4, 100).strength).toBe(0);
        expect(_testRipple(-5, 4, 100).strength).toBe(0);
    });

    it("streams chevron slots with soft fades at both ends", () => {
        const pos = new Float32Array(3);
        const fade = new Float32Array(3);
        _testChevronSlots(0.25, 3, pos, fade);
        expect(Array.from(pos)).toEqual([0.25, 1.25, 2.25]);
        for (const f of fade) {
            expect(f).toBeGreaterThan(0);
            expect(f).toBeLessThanOrEqual(1);
        }
        expect(fade[1]).toBeGreaterThan(fade[0]);
        expect(fade[1]).toBeGreaterThan(fade[2]);
        _testChevronSlots(1.25, 3, pos, fade);
        expect(pos[0]).toBeCloseTo(0.25, 5);
        _testChevronSlots(0, 3, pos, fade);
        expect(fade[0]).toBe(0);
    });

    it("keeps animating until the ripple has spread out", () => {
        const st = _testCreateState();
        st.pressT = 1000;
        st.lastActiveT = -1e9;
        expect(_testNeedsAnimation(st, 1600)).toBe(true);
        expect(_testNeedsAnimation(st, 1700)).toBe(false);
    });

    it("uses a 600 ms trail, 1200 ms in boost", () => {
        expect(_testTrailMs("pointer")).toBe(600);
        expect(_testTrailMs("scroll")).toBe(600);
        expect(_testTrailMs("precision")).toBe(600);
        expect(_testTrailMs("boost")).toBe(1200);
    });
});

describe("TouchpadViz state", () => {
    it("integrates relative deltas into a wandering point, clamped to the pad", () => {
        const st = _testCreateState();
        _testIngest(st, sample({ t: 1, dx: 90, dy: 0 }), 1);
        expect(st.ix).toBeGreaterThan(0.5);
        expect(st.iy).toBeCloseTo(0.5, 5);
        for (let i = 0; i < 100; i++) _testIngest(st, sample({ t: 2 + i, dx: 500, dy: -500 }), 2 + i);
        expect(st.ix).toBeLessThanOrEqual(0.9);
        expect(st.iy).toBeGreaterThanOrEqual(0.1);
    });

    it("moves the dot less in precision and more in boost", () => {
        const move = (mode: PointingMode) => {
            const st = _testCreateState();
            _testIngest(st, sample({ t: 1, dx: 60, mode }), 1);
            return st.ix - 0.5;
        };
        expect(move("precision")).toBeLessThan(move("pointer"));
        expect(move("boost")).toBeGreaterThan(move("pointer"));
    });

    it("ingests each sample once", () => {
        const st = _testCreateState();
        const s = sample({ t: 5, dx: 90 });
        expect(_testIngest(st, s, 5)).toBe(true);
        const x = st.ix;
        expect(_testIngest(st, s, 6)).toBe(false);
        expect(st.ix).toBe(x);
    });

    it("recenters the wandering point once idle", () => {
        const st = _testCreateState();
        _testStep(st, sample({ t: 0, dx: 600, dy: 300 }), 0, 16);
        expect(Math.abs(st.ix - 0.5)).toBeGreaterThan(0.1);
        const s = st;
        for (let t = 16; t < POINTING_IDLE_MS + 2000; t += 16) _testStep(s, sample({ t: 0, dx: 600, dy: 300 }), t, 16);
        expect(st.ix).toBeCloseTo(0.5, 2);
        expect(st.iy).toBeCloseTo(0.5, 2);
        expect(st.activity).toBe(0);
        expect(_testNeedsAnimation(st, POINTING_IDLE_MS + 2000)).toBe(false);
    });

    it("smooths the rate rather than jumping", () => {
        const st = _testCreateState();
        _testStep(st, sample({ t: 0, dx: 66 }), 0, 16);
        expect(st.rateX).toBeGreaterThan(0);
        expect(st.rateX).toBeLessThan(2);
        for (let t = 16; t < 800; t += 16) _testStep(st, sample({ t: Math.floor(t / 33) * 33, dx: 66 }), t, 16);
        expect(st.rateX).toBeCloseTo(2, 1);
    });

    it("draws saturated samples at full magnitude", () => {
        const st = _testCreateState();
        _testStep(st, sample({ t: 0, dx: 1, saturated: true }), 0, 16);
        expect(st.magnitude).toBe(1);
    });

    it("eases into activity and back out to idle", () => {
        const st = _testCreateState();
        _testStep(st, sample({ t: 0, dx: 30 }), 0, 16);
        expect(st.activity).toBeGreaterThan(0);
        expect(st.activity).toBeLessThan(1);
        for (let t = 16; t <= 600; t += 16) _testStep(st, sample({ t: Math.floor(t / 33) * 33, dx: 30 }), t, 16);
        expect(st.activity).toBe(1);
    });

    it("pulses on a button press edge only", () => {
        const st = _testCreateState();
        _testIngest(st, sample({ t: 1, buttons: 1 }), 100);
        expect(st.pressT).toBe(100);
        _testIngest(st, sample({ t: 2, buttons: 1 }), 133);
        expect(st.pressT).toBe(100);
        _testIngest(st, sample({ t: 3, buttons: 0 }), 166);
        _testIngest(st, sample({ t: 4, buttons: 1 }), 200);
        expect(st.pressT).toBe(200);
    });

    it("follows touch positions directly, and snaps on a new touch", () => {
        const st = _testCreateState();
        _testIngest(st, sample({ t: 1, touches: [{ x: 0.2, y: 0.8 }], fingers: 1 }), 1);
        expect(st.dotX[0]).toBeCloseTo(0.1 + 0.2 * 0.8, 5);
        expect(st.dotY[0]).toBeCloseTo(0.1 + 0.8 * 0.8, 5);
        expect(st.fingers).toBe(1);
    });

    it("shows two dots for two touches or fingers === 2, whatever the mode", () => {
        const st = _testCreateState();
        _testIngest(st, sample({ t: 1, touches: [{ x: 0.3, y: 0.3 }, { x: 0.7, y: 0.6 }] }), 1);
        expect(st.fingers).toBe(2);
        expect(st.targetX[1]).toBeCloseTo(0.1 + 0.7 * 0.8, 5);
        const st2 = _testCreateState();
        _testIngest(st2, sample({ t: 1, fingers: 2, mode: "precision", precision: true }), 1);
        expect(st2.fingers).toBe(2);
    });
});

describe("TouchpadViz scroll", () => {
    it("picks the scroll axis from lock, then wheel, then motion", () => {
        expect(_testScrollAxis(sample({ axisLock: "horizontal", dy: 50 }), "vertical")).toBe("horizontal");
        expect(_testScrollAxis(sample({ axisLock: "vertical", dx: 50 }), "horizontal")).toBe("vertical");
        expect(_testScrollAxis(sample({ h: 3, v: 1 }), "vertical")).toBe("horizontal");
        expect(_testScrollAxis(sample({ dx: 40, dy: 10 }), "vertical")).toBe("horizontal");
        expect(_testScrollAxis(sample({}), "horizontal")).toBe("horizontal");
    });

    it("draws scroll in finger direction, reversed by natural scroll", () => {
        const down = _testScrollRate(sample({ dy: 33 }), "vertical");
        expect(down).toBeCloseTo(1, 5);
        expect(_testScrollRate(sample({ dy: 33, naturalScroll: true }), "vertical")).toBeCloseTo(-1, 5);
        // Wheel +v (up) reads as finger moving up.
        expect(_testScrollRate(sample({ v: 2 }), "vertical")).toBeLessThan(0);
        expect(_testScrollRate(sample({ h: 2 }), "horizontal")).toBeGreaterThan(0);
    });

    it("places two parallel fingers beside each other, on the pad", () => {
        const outX = new Float32Array(2);
        const outY = new Float32Array(2);
        _testFingerTargets({ ix: 0.5, iy: 0.5, axis: "vertical" }, undefined, 2, outX, outY);
        expect(outY[0]).toBeCloseTo(outY[1], 5);
        expect(outX[1] - outX[0]).toBeCloseTo(0.2, 5);
        _testFingerTargets({ ix: 0.9, iy: 0.5, axis: "vertical" }, undefined, 2, outX, outY);
        expect(outX[1]).toBeLessThanOrEqual(0.9 + 1e-6);
        _testFingerTargets({ ix: 0.5, iy: 0.5, axis: "horizontal" }, undefined, 2, outX, outY);
        expect(outX[0]).toBeCloseTo(outX[1], 5);
        expect(outY[1] - outY[0]).toBeCloseTo(0.2, 5);
    });

    it("keeps the scroll look while the driver emits wheel units outside scroll mode", () => {
        const st = _testCreateState();
        _testStep(st, sample({ t: 0, v: -3 }), 0, 16);
        expect(st.fingers).toBe(2);
        expect(st.scrollRate).toBeGreaterThan(0);
    });

    it("streams the chevron phase in the scroll direction", () => {
        const st = runSim("scroll", 1500);
        expect(st.fingers).toBe(2);
        const st2 = _testCreateState();
        let phaseMoved = 0;
        for (let t = 0; t < 600; t += 16) {
            const before = st2.scrollPhase;
            _testStep(st2, sample({ t: Math.floor(t / 33) * 33, dy: 60, mode: "scroll", scrolling: true, axisLock: "vertical" }), t, 16);
            phaseMoved += ((st2.scrollPhase - before + 1.5) % 1) - 0.5;
        }
        expect(phaseMoved).toBeGreaterThan(0);
    });
});

describe("TouchpadViz trails", () => {
    it("stores trail points in a ring buffer and ages them out", () => {
        const st = _testCreateState();
        const trail = st.trails[0];
        for (let i = 0; i < 400; i++) _testTrailPush(trail, i / 400, 0.5, i * 10);
        expect(trail.count).toBeLessThanOrEqual(160);
        expect(_testTrailLiveCount(trail, 3990, 600)).toBe(61);
        expect(_testTrailLiveCount(trail, 99999, 600)).toBe(0);
    });

    it("records a second trail only with two fingers", () => {
        const pointer = runSim("pointer", 800);
        expect(pointer.trails[0].count).toBeGreaterThan(10);
        expect(pointer.trails[1].count).toBe(0);
        const scroll = runSim("scroll", 800);
        expect(scroll.trails[1].count).toBeGreaterThan(10);
    });

    it("records no trail when idle", () => {
        const idle = runSim("idle", 800);
        expect(idle.trails[0].count).toBe(0);
        expect(idle.activity).toBe(0);
    });

    it("wanders without touches, from relative deltas", () => {
        const st = runSim("pointer", 1500, false);
        expect(st.hasTouch).toBe(false);
        expect(Math.hypot(st.dotX[0] - 0.5, st.dotY[0] - 0.5)).toBeGreaterThan(0.01);
    });
});

describe("TouchpadViz reduced motion snapshot", () => {
    it("jumps straight to the sample, without trails", () => {
        const st = _testCreateState();
        _testSnap(st, sample({ t: 10, dx: 40, touches: [{ x: 0.25, y: 0.75 }] }), 10);
        expect(st.dotX[0]).toBeCloseTo(0.1 + 0.25 * 0.8, 5);
        expect(st.activity).toBe(1);
        expect(st.rateX).toBeCloseTo(40 / 33, 5);
        expect(st.trails[0].count).toBe(0);
        _testSnap(st, null, 10000);
        expect(st.activity).toBe(0);
    });
});

describe("TouchpadViz drawing", () => {
    function recordingContext() {
        const calls: string[] = [];
        const ops = new Set<string>();
        const gradient = () => ({ addColorStop() {} });
        const target: Record<string, unknown> = {
            createRadialGradient: (...args: number[]) => {
                for (const a of args) expect(Number.isFinite(a)).toBe(true);
                calls.push("radial");
                return gradient();
            },
            createLinearGradient: (...args: number[]) => {
                for (const a of args) expect(Number.isFinite(a)).toBe(true);
                calls.push("linear");
                return gradient();
            },
        };
        const handler: ProxyHandler<Record<string, unknown>> = {
            get(t, prop: string) {
                if (prop in t) return t[prop];
                return (..._args: unknown[]) => {
                    calls.push(prop);
                };
            },
            set(t, prop: string, value) {
                t[prop] = value;
                if (prop === "strokeStyle" || prop === "fillStyle") calls.push(`${prop}=${typeof value === "string" ? value : "gradient"}`);
                if (prop === "globalCompositeOperation") ops.add(String(value));
                return true;
            },
        };
        const ctx = new Proxy(target, handler) as unknown as CanvasRenderingContext2D;
        return { ctx, calls, ops, state: target };
    }
    const theme = { ...DEFAULT_POINTING_VIZ_THEME, foreground: "FG", muted: "MU", accent: "AC", border: "BO" };

    const drawFor = (mode: PointingMode | "idle", reducedMotion = false, size: [number, number] = [95, 95]) => {
        const st = runSim(mode, 1200);
        const rec = recordingContext();
        _testDraw(rec.ctx, st, 1200, { width: size[0], height: size[1], theme, side: "left", reducedMotion });
        return rec;
    };

    it("draws something different for every mode, at every slot size", () => {
        for (const size of [[60, 60], [95, 95], [130, 130]] as [number, number][]) {
            const sigs = new Set<string>();
            for (const mode of ["idle", "pointer", "scroll", "precision", "boost"] as const) {
                sigs.add(drawFor(mode, false, size).calls.join(","));
            }
            expect(sigs.size).toBe(5);
        }
    });

    it("uses only theme tokens or fixed glass/light colours", () => {
        for (const mode of ["idle", "pointer", "scroll", "precision", "boost"] as const) {
            for (const c of drawFor(mode).calls) {
                if (!c.startsWith("strokeStyle=") && !c.startsWith("fillStyle=")) continue;
                const v = c.split("=")[1];
                expect(v === "AC" || v === "BO" || v === "gradient" || v.startsWith("rgba(")).toBe(true);
            }
        }
    });

    it("adds the glows with 'lighter' and restores source-over", () => {
        const rec = drawFor("pointer");
        expect(rec.ops.has("lighter")).toBe(true);
        expect(rec.state.globalCompositeOperation).toBe("source-over");
        expect(rec.state.globalAlpha).toBe(1);
    });

    it("draws contact glows (radial gradients) only when active", () => {
        const idle = drawFor("idle").calls.filter((c) => c === "radial").length;
        const pointer = drawFor("pointer").calls.filter((c) => c === "radial").length;
        const scroll = drawFor("scroll").calls.filter((c) => c === "radial").length;
        // Contact = halo + core + hot centre.
        expect(pointer - idle).toBe(3);
        expect(scroll - idle).toBe(6);
    });

    it("uses accent strokes for scroll chevrons, not for plain pointer", () => {
        expect(drawFor("scroll").calls).toContain("strokeStyle=AC");
        expect(drawFor("pointer").calls).not.toContain("strokeStyle=AC");
    });

    it("draws a ripple ring after a button press", () => {
        const st = runSim("pointer", 1200);
        st.pressT = 1100;
        const rec = recordingContext();
        _testDraw(rec.ctx, st, 1200, { width: 95, height: 95, theme, side: "left", reducedMotion: false });
        expect(rec.calls).toContain("strokeStyle=AC");
    });

    it("draws a reduced-motion frame without throwing", () => {
        expect(() => drawFor("pointer", true)).not.toThrow();
        expect(() => drawFor("scroll", true)).not.toThrow();
        expect(() => drawFor("boost", true, [60, 60])).not.toThrow();
    });

    it("isActive ignores zero samples", () => {
        expect(_testIsActive(sample())).toBe(false);
        expect(_testIsActive(null)).toBe(false);
        expect(_testIsActive(sample({ v: 1 }))).toBe(true);
        expect(_testIsActive(sample({ touches: [{ x: 0, y: 0 }] }))).toBe(true);
    });
});
