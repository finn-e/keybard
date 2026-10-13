import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    TrackpointViz,
    _testArrowGeometry,
    _testCreateArrowGeometry,
    _testCreateState,
    _testDraw,
    _testIsSettled,
    _testSampleRate,
    _testScrollAxis,
    _testStep,
} from "@/components/pointing-viz/TrackpointViz";
import { simulateSample } from "@/components/pointing-viz/simulate";
import {
    DEFAULT_POINTING_VIZ_THEME,
    POINTING_IDLE_MS,
    type PointingLiveSample,
    type PointingMode,
    type PointingSampleSource,
} from "@/components/pointing-viz/types";

function sample(over: Partial<PointingLiveSample> = {}): PointingLiveSample {
    const mode: PointingMode = over.mode ?? "pointer";
    return {
        t: 0,
        dtMs: 33,
        dx: 0,
        dy: 0,
        h: 0,
        v: 0,
        buttons: 0,
        mode,
        scrolling: mode === "scroll",
        precision: mode === "precision",
        boost: mode === "boost",
        axisLock: "free",
        naturalScroll: false,
        autoMouseLayer: false,
        saturated: false,
        ...over,
    };
}

/** Holds a constant push of `s` (re-stamped every frame) for `ms`, stepping at 16 ms. */
function hold(st: ReturnType<typeof _testCreateState>, s: Partial<PointingLiveSample>, fromMs: number, ms: number): number {
    let now = fromMs;
    for (let t = 0; t < ms; t += 16) {
        now += 16;
        _testStep(st, sample({ ...s, t: now }), now, 16);
    }
    return now;
}

function release(st: ReturnType<typeof _testCreateState>, fromMs: number, ms: number): number {
    const last = sample({ t: fromMs });
    let now = fromMs;
    for (let t = 0; t < ms; t += 16) {
        now += 16;
        _testStep(st, last, now, 16);
    }
    return now;
}

describe("TrackpointViz math", () => {
    it("smooths toward the push and grows an arrow in its direction", () => {
        const st = _testCreateState();
        const g = _testCreateArrowGeometry();
        let now = hold(st, { dx: 66, dy: 0 }, 0, 40);
        const early = Math.hypot(st.ax, st.ay);
        now = hold(st, { dx: 66, dy: 0 }, now, 800);
        expect(st.vx).toBeCloseTo(2, 1); // 66 counts / 33 ms
        expect(Math.hypot(st.ax, st.ay)).toBeGreaterThan(early);
        expect(st.angle).toBeCloseTo(0, 2);
        expect(st.idle).toBe(0);
        _testArrowGeometry(st.ax, st.ay, st.angle, "pointer", 100, g);
        expect(g.visible).toBe(true);
        expect(g.length).toBeLessThanOrEqual(45 + 1e-6);
        expect(now).toBeGreaterThan(0);
    });

    it("points up for a negative dy push (screen coordinates)", () => {
        const st = _testCreateState();
        hold(st, { dx: 0, dy: -50 }, 0, 600);
        expect(st.angle).toBeCloseTo(-Math.PI / 2, 2);
    });

    it("springs back past zero on release, then settles to an idle dot", () => {
        const st = _testCreateState();
        let now = hold(st, { dx: 80, dy: 0 }, 0, 800);
        expect(st.ax).toBeGreaterThan(0.5);
        let minAx = Infinity;
        const last = sample({ t: now });
        for (let i = 0; i < 40; i++) {
            now += 16;
            _testStep(st, last, now, 16);
            minAx = Math.min(minAx, st.ax);
        }
        expect(minAx).toBeLessThan(0); // overshoot: it springs, not just fades
        now = release(st, now, POINTING_IDLE_MS + 600);
        expect(Math.abs(st.ax)).toBeLessThan(1e-3);
        expect(st.idle).toBe(1);
        expect(_testIsSettled(st, now)).toBe(true);
    });

    it("eases into idle over ~400 ms rather than snapping", () => {
        const st = _testCreateState();
        let now = hold(st, { dx: 20 }, 0, 300);
        now = release(st, now, POINTING_IDLE_MS + 100);
        expect(st.idle).toBeGreaterThan(0);
        expect(st.idle).toBeLessThan(1);
        release(st, now, 400);
        expect(st.idle).toBe(1);
    });

    it("draws saturated samples at full magnitude", () => {
        const st = _testCreateState();
        hold(st, { dx: 1, dy: 0, saturated: true }, 0, 1000);
        expect(Math.hypot(st.ax, st.ay)).toBeCloseTo(1, 2);
    });

    it("gives every mode a distinct arrow", () => {
        const g = _testCreateArrowGeometry();
        const size = 100;
        const pointer = { ..._testArrowGeometry(0.8, 0, 0, "pointer", size, g) };
        const precision = { ..._testArrowGeometry(0.8, 0, 0, "precision", size, g) };
        const boost = { ..._testArrowGeometry(0.8, 0, 0, "boost", size, g) };
        const scroll = { ..._testArrowGeometry(0.8, 0, 0, "scroll", size, g) };

        expect(precision.shaftWidth).toBe(1);
        expect(precision.ticks).toBe(3);
        expect(precision.length).toBeLessThan(pointer.length);
        expect(boost.shaftWidth).toBeGreaterThan(pointer.shaftWidth);
        expect(boost.glow).toBe(6);
        expect(pointer.glow).toBe(0);
        expect(scroll.headLength).toBe(0);
        expect(pointer.length).toBeCloseTo(0.8 * 45, 5);
    });

    it("scales head width with magnitude and caps length at 45% of size", () => {
        const g = _testCreateArrowGeometry();
        const small = { ..._testArrowGeometry(0.3, 0, 0, "pointer", 140, g) };
        const big = { ..._testArrowGeometry(1, 0, 0, "pointer", 140, g) };
        expect(big.headWidth).toBeGreaterThan(small.headWidth);
        expect(big.length).toBeCloseTo(0.45 * 140, 5);
    });

    it("stays legible at a 60 px drawing area", () => {
        const g = _testArrowGeometry(1, 0, 0, "pointer", 60, _testCreateArrowGeometry());
        expect(g.nubRadius).toBeGreaterThanOrEqual(3);
        expect(g.headWidth).toBeGreaterThanOrEqual(5);
        expect(g.length).toBeGreaterThan(g.nubRadius * 3);
    });

    it("hides the arrow while it is still inside the nub", () => {
        const g = _testArrowGeometry(0.02, 0, 0, "pointer", 100, _testCreateArrowGeometry());
        expect(g.visible).toBe(false);
    });

    it("picks the scroll axis per the spec", () => {
        expect(_testScrollAxis("free", 0.1, 2)).toBe("vertical");
        expect(_testScrollAxis("free", 3, 2)).toBe("horizontal");
        expect(_testScrollAxis("vertical", 3, 0)).toBe("vertical");
        expect(_testScrollAxis("horizontal", 0, 3)).toBe("horizontal");
    });

    it("uses driver wheel units in scroll mode, dx/dy otherwise", () => {
        const out = { x: 0, y: 0 };
        _testSampleRate(sample({ mode: "scroll", dx: 0, dy: 33, v: 2 }), out);
        expect(out.y).toBeCloseTo((-2 * 8) / 33, 6); // +v = up
        _testSampleRate(sample({ mode: "pointer", dx: 33, dy: 66, v: 2 }), out);
        expect(out.x).toBeCloseTo(1, 6);
        expect(out.y).toBeCloseTo(2, 6);
    });

    it("locks the scroll arrow to the axis and streams chevrons in the push direction", () => {
        const st = _testCreateState();
        hold(st, { mode: "scroll", dx: 30, dy: 60, axisLock: "vertical" }, 0, 500);
        expect(st.scrollAxis).toBe("vertical");
        expect(Math.abs(st.ax)).toBeLessThan(1e-3);
        expect(st.ay).toBeGreaterThan(0.3);
        expect(st.scrollSign).toBe(1);
        const p0 = st.scrollPhase;
        hold(st, { mode: "scroll", dx: 30, dy: 60, axisLock: "vertical" }, 500, 100);
        expect(st.scrollPhase).not.toBeCloseTo(p0, 4);
    });

    it("reverses the drawn scroll direction under natural scrolling", () => {
        const st = _testCreateState();
        hold(st, { mode: "scroll", dy: 60, naturalScroll: true }, 0, 500);
        expect(st.ay).toBeLessThan(-0.3);
        expect(st.scrollSign).toBe(-1);
    });

    it("flashes on button presses for 150 ms", () => {
        const st = _testCreateState();
        _testStep(st, sample({ t: 10, buttons: 1 }), 10, 16);
        expect(st.flashUntil).toBe(160);
        expect(_testIsSettled(st, 100)).toBe(false);
    });

    it("snaps straight to the target for reduced-motion frames", () => {
        const st = _testCreateState();
        _testStep(st, sample({ t: 100, dx: 66 }), 100, 0, true);
        expect(st.vx).toBeCloseTo(2, 6);
        expect(st.idle).toBe(0);
        expect(st.avx).toBe(0);
    });

    it("draws every mode through a canvas context without throwing", () => {
        const calls: string[] = [];
        const ctx = new Proxy(
            {},
            {
                get: (_t, prop: string) => {
                    if (prop in { globalAlpha: 1, fillStyle: 1, strokeStyle: 1, lineWidth: 1, lineCap: 1, lineJoin: 1, shadowBlur: 1, shadowColor: 1 }) return 0;
                    return (..._args: unknown[]) => {
                        calls.push(prop);
                    };
                },
                set: () => true,
            },
        ) as unknown as CanvasRenderingContext2D;
        const g = _testCreateArrowGeometry();
        for (const mode of ["pointer", "scroll", "precision", "boost"] as const) {
            const st = _testCreateState();
            const now = hold(st, { mode, dx: 40, dy: -30, buttons: 1 }, 0, 300);
            calls.length = 0;
            expect(() => _testDraw(ctx, st, g, DEFAULT_POINTING_VIZ_THEME, 80, 80, now, true)).not.toThrow();
            expect(calls).toContain("clearRect");
            expect(calls).toContain("fill");
        }
        const idle = _testCreateState();
        expect(() => _testDraw(ctx, idle, g, DEFAULT_POINTING_VIZ_THEME, 60, 60, 0, false)).not.toThrow();
    });
});

describe("TrackpointViz component", () => {
    function fakeSource(module: "trackpoint" = "trackpoint") {
        const unsubscribe = vi.fn();
        let listener: ((s: PointingLiveSample) => void) | null = null;
        const source: PointingSampleSource = {
            latest: () => simulateSample(module, "left", performance.now(), { mode: "pointer" }),
            subscribe: vi.fn((l) => {
                listener = l;
                return unsubscribe;
            }),
        };
        return { source, unsubscribe, emit: (s: PointingLiveSample) => listener?.(s) };
    }

    let rafSpy: ReturnType<typeof vi.spyOn>;
    let cancelSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        rafSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 42);
        cancelSpy = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    const props = {
        side: "left" as const,
        width: 80,
        height: 80,
        theme: DEFAULT_POINTING_VIZ_THEME,
    };

    it("renders an accessible wrapper with a hidden canvas and does not throw", () => {
        const { source } = fakeSource();
        const { getByRole, container } = render(<TrackpointViz {...props} source={source} reducedMotion={false} />);
        const img = getByRole("img");
        expect(img.getAttribute("aria-label")).toMatch(/left/i);
        expect(img.getAttribute("aria-label")).toMatch(/trackpoint/i);
        expect(container.querySelector("canvas")?.getAttribute("aria-hidden")).toBe("true");
    });

    it("labels the right hand", () => {
        const { source } = fakeSource();
        const { getByRole } = render(<TrackpointViz {...props} side="right" source={source} reducedMotion={false} />);
        expect(getByRole("img").getAttribute("aria-label")).toBe("Right trackpoint");
    });

    it("runs a RAF loop and cancels it and unsubscribes on unmount", () => {
        const { source, unsubscribe } = fakeSource();
        const { unmount } = render(<TrackpointViz {...props} source={source} reducedMotion={false} />);
        expect(rafSpy).toHaveBeenCalled();
        expect(source.subscribe).toHaveBeenCalledTimes(1);
        unmount();
        expect(cancelSpy).toHaveBeenCalledWith(42);
        expect(unsubscribe).toHaveBeenCalled();
    });

    it("schedules no RAF under reduced motion and still handles samples", () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        try {
            const { source, unsubscribe, emit } = fakeSource();
            const { unmount } = render(<TrackpointViz {...props} source={source} reducedMotion={true} />);
            act(() => {
                emit(sample({ t: performance.now(), dx: 10 }));
                emit(sample({ t: performance.now(), dx: 12 }));
                vi.advanceTimersByTime(300);
            });
            expect(rafSpy).not.toHaveBeenCalled();
            unmount();
            expect(unsubscribe).toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it("survives a source with no samples yet", () => {
        const source: PointingSampleSource = { latest: () => null, subscribe: () => () => {} };
        expect(() => render(<TrackpointViz {...props} source={source} reducedMotion={false} />)).not.toThrow();
        expect(() => render(<TrackpointViz {...props} source={source} reducedMotion={true} />)).not.toThrow();
    });
});
