import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TrackpointViz, _testTrackpoint as T, type TrackpointState } from "@/components/pointing-viz/TrackpointViz";
import { simulateSample } from "@/components/pointing-viz/simulate";
import {
    DEFAULT_POINTING_VIZ_THEME,
    POINTING_IDLE_MS,
    type PointingLiveSample,
    type PointingMode,
    type PointingSampleSource,
} from "@/components/pointing-viz/types";

function sample(over: Partial<PointingLiveSample> & { pressure?: number } = {}): PointingLiveSample {
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
function hold(st: TrackpointState, s: Partial<PointingLiveSample> & { pressure?: number }, fromMs: number, ms: number): number {
    let now = fromMs;
    for (let t = 0; t < ms; t += 16) {
        now += 16;
        T.step(st, sample({ ...s, t: now }), now, 16);
    }
    return now;
}

/** Lets go: the last sample stays the latest (stale, motionless) while frames run. */
function release(st: TrackpointState, fromMs: number, ms: number, onFrame?: (st: TrackpointState) => void): number {
    const last = sample({ t: fromMs });
    let now = fromMs;
    for (let t = 0; t < ms; t += 16) {
        now += 16;
        T.step(st, last, now, 16);
        onFrame?.(st);
    }
    return now;
}

/** Counts sign changes of a series, ignoring values within `eps` of zero. */
function zeroCrossings(xs: number[], eps = 1e-3): number {
    let n = 0;
    let prev = 0;
    for (const x of xs) {
        if (Math.abs(x) < eps) continue;
        const sgn = Math.sign(x);
        if (prev !== 0 && sgn !== prev) n++;
        prev = sgn;
    }
    return n;
}

function stubCtx(calls: string[] = []): CanvasRenderingContext2D {
    const gradient = { addColorStop() {} };
    return new Proxy(
        {},
        {
            get: (_t, prop: string) => {
                if (prop === "createRadialGradient" || prop === "createLinearGradient") return () => gradient;
                if (["globalAlpha", "fillStyle", "strokeStyle", "lineWidth", "lineCap", "lineJoin", "shadowBlur", "shadowColor"].includes(prop)) return 0;
                return (..._args: unknown[]) => {
                    calls.push(prop);
                };
            },
            set: () => true,
        },
    ) as unknown as CanvasRenderingContext2D;
}

describe("TrackpointViz bend spring", () => {
    it("smooths toward the push and bends the stalk in its direction", () => {
        const st = T.createState();
        let now = hold(st, { dx: 66, dy: 0 }, 0, 40);
        const early = st.bx;
        now = hold(st, { dx: 66, dy: 0 }, now, 800);
        expect(st.vx).toBeCloseTo(2, 1); // 66 counts / 33 ms
        expect(st.bx).toBeGreaterThan(early);
        expect(st.bx).toBeGreaterThan(0.5);
        expect(Math.abs(st.by)).toBeLessThan(1e-6);
        // Held steadily, it settles on the target (force × pointer gain) without wobbling.
        expect(st.bx).toBeCloseTo(st.fx * T.MODE_GAIN.pointer, 2);
        expect(st.idle).toBe(0);
        expect(now).toBeGreaterThan(0);
    });

    it("bends toward the viewer for +dy and away for -dy", () => {
        const toward = T.createState();
        hold(toward, { dy: 50 }, 0, 600);
        expect(toward.by).toBeGreaterThan(0.3);
        const away = T.createState();
        hold(away, { dy: -50 }, 0, 600);
        expect(away.by).toBeLessThan(-0.3);
    });

    it("bends less in precision and more in boost", () => {
        const bend = (mode: PointingMode) => {
            const st = T.createState();
            hold(st, { mode, dx: 40 }, 0, 800);
            return st.bx;
        };
        expect(bend("precision")).toBeLessThan(bend("pointer") * 0.5);
        expect(bend("boost")).toBeGreaterThan(bend("pointer"));
    });

    it("sways back and forth with decaying amplitude on release, like a palm after a gust", () => {
        const st = T.createState();
        const now = hold(st, { dx: 80 }, 0, 800);
        const start = st.bx;
        const xs: number[] = [];
        release(st, now, 1500, (s) => xs.push(s.bx));
        // At least two swings past upright...
        expect(zeroCrossings(xs)).toBeGreaterThanOrEqual(2);
        // ...each smaller than the last.
        const peaks: number[] = [];
        for (let i = 1; i < xs.length - 1; i++) {
            if (Math.abs(xs[i]) >= Math.abs(xs[i - 1]) && Math.abs(xs[i]) > Math.abs(xs[i + 1]) && Math.abs(xs[i]) > 1e-3) peaks.push(Math.abs(xs[i]));
        }
        expect(peaks.length).toBeGreaterThanOrEqual(2);
        expect(peaks[0]).toBeLessThan(start);
        for (let i = 1; i < peaks.length; i++) expect(peaks[i]).toBeLessThan(peaks[i - 1]);
        expect(Math.abs(xs[xs.length - 1])).toBeLessThan(0.02);
    });

    it("damps hard while pushing and lightly after release", () => {
        expect(T.PUSH_ZETA).toBeGreaterThan(T.SWAY_ZETA * 3);
        // springBend picks the damping from the target: zero target = sway damping.
        const a = T.createState();
        const b = T.createState();
        a.bx = b.bx = 0.5;
        a.bvx = b.bvx = 2;
        T.springBend(a, 0, 0, 0.008);
        T.springBend(b, 0.5, 0, 0.008);
        // Same displacement from target is not the point; the pushed one loses more velocity to damping.
        expect(b.bvx).toBeLessThan(2);
        expect(a.bvx).toBeLessThan(2);
        const dampA = 2 * T.SWAY_ZETA * Math.sqrt(T.SPRING_K) * 2 * 0.008;
        expect(a.bvx).toBeCloseTo(2 + (T.SPRING_K * -0.5 * 0.008) - dampA, 6);
    });

    it("settles: the nub stands straight and still, and the loop may stop", () => {
        const st = T.createState();
        let now = hold(st, { dx: 80 }, 0, 600);
        expect(T.isSettled(st, now)).toBe(false);
        now = release(st, now, POINTING_IDLE_MS + 2500);
        expect(Math.abs(st.bx)).toBeLessThan(2e-3);
        expect(Math.abs(st.bvx)).toBeLessThan(2e-2);
        expect(st.idle).toBe(1);
        expect(T.isSettled(st, now)).toBe(true);
    });

    it("is settled from the start with no samples", () => {
        expect(T.isSettled(T.createState(), 0)).toBe(true);
    });

    it("bends saturated samples at full force", () => {
        const st = T.createState();
        hold(st, { dx: 1, dy: 0, saturated: true }, 0, 1000);
        expect(Math.hypot(st.fx, st.fy)).toBeCloseTo(1, 2);
        expect(st.bx).toBeCloseTo(T.MODE_GAIN.pointer, 2);
    });

    it("snaps straight to the bent pose for reduced-motion frames", () => {
        const st = T.createState();
        T.step(st, sample({ t: 100, dx: 66 }), 100, 0, true);
        expect(st.vx).toBeCloseTo(2, 6);
        expect(st.bx).toBeCloseTo(st.fx * T.MODE_GAIN.pointer, 9);
        expect(st.bvx).toBe(0);
        expect(st.idle).toBe(0);
    });
});

describe("TrackpointViz scroll", () => {
    it("picks the scroll axis per the spec", () => {
        expect(T.scrollAxisFor("free", 0.1, 2)).toBe("vertical");
        expect(T.scrollAxisFor("free", 3, 2)).toBe("horizontal");
        expect(T.scrollAxisFor("vertical", 3, 0)).toBe("vertical");
        expect(T.scrollAxisFor("horizontal", 0, 3)).toBe("horizontal");
    });

    it("uses driver wheel units in scroll mode, dx/dy otherwise", () => {
        const out = { x: 0, y: 0 };
        T.sampleRate(sample({ mode: "scroll", dx: 0, dy: 33, v: 2 }), out);
        expect(out.y).toBeCloseTo((-2 * 8) / 33, 6); // +v = up
        T.sampleRate(sample({ mode: "pointer", dx: 33, dy: 66, v: 2 }), out);
        expect(out.x).toBeCloseTo(1, 6);
        expect(out.y).toBeCloseTo(2, 6);
    });

    it("bends only along the locked axis", () => {
        const st = T.createState();
        hold(st, { mode: "scroll", dx: 60, dy: 30, axisLock: "vertical" }, 0, 600);
        expect(st.scrollAxis).toBe("vertical");
        expect(st.fx).toBe(0);
        expect(Math.abs(st.bx)).toBeLessThan(1e-6);
        expect(st.by).toBeGreaterThan(0.2);
        expect(st.scrollSign).toBe(1);

        const h = T.createState();
        hold(h, { mode: "scroll", dx: -20, dy: 60, axisLock: "horizontal" }, 0, 600);
        expect(h.scrollAxis).toBe("horizontal");
        expect(Math.abs(h.by)).toBeLessThan(1e-6);
        expect(h.bx).toBeLessThan(-0.1);
        expect(h.scrollSign).toBe(-1);
    });

    it("advances the chevron phase while scrolling", () => {
        const st = T.createState();
        const now = hold(st, { mode: "scroll", dy: 60, axisLock: "vertical" }, 0, 300);
        const p0 = st.phase;
        hold(st, { mode: "scroll", dy: 60, axisLock: "vertical" }, now, 100);
        expect(st.phase).not.toBeCloseTo(p0, 4);
    });

    it("flips the chevrons, not the bend, under natural scrolling", () => {
        const st = T.createState();
        hold(st, { mode: "scroll", dy: 60, naturalScroll: true }, 0, 600);
        expect(st.by).toBeGreaterThan(0.2); // the finger still pushes toward the viewer
        expect(st.scrollSign).toBe(-1); // the content scrolls the other way
    });
});

describe("TrackpointViz squish (Z pressure)", () => {
    it("squishes on a button press, then boings back past rest", () => {
        const st = T.createState();
        let now = hold(st, { buttons: 1 }, 0, 300);
        expect(st.squish).toBeGreaterThan(0.8);
        expect(T.isSettled(st, now)).toBe(false);
        let min = Infinity;
        now = release(st, now, 600, (s) => {
            min = Math.min(min, s.squish);
        });
        expect(min).toBeLessThan(-0.1); // overshoot: it stretches up before settling
        expect(min).toBeGreaterThan(-0.9);
        now = release(st, now, POINTING_IDLE_MS + 600);
        expect(st.squish).toBe(0);
        expect(T.isSettled(st, now)).toBe(true);
    });

    it("keeps the cap pressed while the button is held", () => {
        const st = T.createState();
        hold(st, { buttons: 1 }, 0, 1500);
        expect(st.squish).toBeCloseTo(1, 2);
    });

    it("reads an optional pressure 0..1 off the sample to set the depth", () => {
        expect(T.samplePressure(sample())).toBe(-1);
        expect(T.samplePressure(sample({ pressure: 0.4 }))).toBeCloseTo(0.4, 9);
        expect(T.samplePressure(sample({ pressure: 7 }))).toBe(1);
        expect(T.samplePressure(sample({ pressure: Number.NaN }))).toBe(-1);
        expect(T.samplePressure({ ...sample(), pressure: "x" } as unknown as PointingLiveSample)).toBe(-1);
        const st = T.createState();
        hold(st, { pressure: 0.4 }, 0, 1500);
        expect(st.squish).toBeCloseTo(0.4, 2);
        // Pressure wins over a button press when both are present.
        hold(st, { pressure: 0.2, buttons: 1 }, 1500, 1500);
        expect(st.squish).toBeCloseTo(0.2, 2);
    });

    it("is underdamped (boings) but stable", () => {
        expect(T.SQUISH_ZETA).toBeGreaterThan(0.1);
        expect(T.SQUISH_ZETA).toBeLessThan(0.5);
        const st = T.createState();
        st.squish = 1;
        for (let i = 0; i < 1000; i++) T.springSquish(st, 0, 0.008);
        expect(Math.abs(st.squish)).toBeLessThan(1e-3);
    });
});

describe("TrackpointViz geometry", () => {
    it("plants the base and bends the tip the push direction, keeping the stalk length", () => {
        const pose = T.createSpinePose();
        const n = T.SPINE_SEGMENTS;
        T.computeSpine(0, 0, 5, 50, pose);
        expect(pose.pts[0]).toBe(0);
        expect(pose.pts[1]).toBe(5);
        expect(pose.pts[n * 3]).toBeCloseTo(0, 9);
        expect(pose.pts[n * 3 + 1]).toBeCloseTo(55, 9);

        T.computeSpine(0.8, 0, 5, 50, pose);
        expect(pose.pts[0]).toBe(0);
        expect(pose.pts[1]).toBe(5);
        expect(pose.pts[n * 3]).toBeGreaterThan(10); // tip to the right
        expect(pose.pts[n * 3 + 2]).toBeCloseTo(0, 9);
        expect(pose.angle).toBeCloseTo(0.8 * T.BEND_MAX_RAD, 9);
        let len = 0;
        for (let i = 1; i <= n; i++) {
            len += Math.hypot(pose.pts[i * 3] - pose.pts[i * 3 - 3], pose.pts[i * 3 + 1] - pose.pts[i * 3 - 2], pose.pts[i * 3 + 2] - pose.pts[i * 3 - 1]);
        }
        expect(len).toBeCloseTo(50, 6);
        // Palm-like: the base leaves nearly vertical, the top bends most.
        const lowerSlope = (pose.pts[3] - pose.pts[0]) / (pose.pts[4] - pose.pts[1]);
        const upperSlope = (pose.pts[n * 3] - pose.pts[n * 3 - 3]) / (pose.pts[n * 3 + 1] - pose.pts[n * 3 - 2]);
        expect(upperSlope).toBeGreaterThan(lowerSlope * 5);

        T.computeSpine(0, 0.8, 5, 50, pose);
        expect(pose.pts[n * 3 + 2]).toBeGreaterThan(10); // toward the viewer
    });

    it("caps the bend angle", () => {
        expect(T.bendAngle(10, 10)).toBe(T.BEND_LIMIT_RAD);
        expect(T.bendAngle(0.3, 0.4)).toBeCloseTo(0.5 * T.BEND_MAX_RAD, 9);
    });

    it("projects toward-the-viewer leans down the screen and foreshortens them", () => {
        const L = T.nubLayout(160, 160, T.createNubLayout());
        const out = new Float64Array(3);
        const pose = T.createSpinePose();
        const n = T.SPINE_SEGMENTS;
        const tipScreenY = (bx: number, by: number) => {
            T.computeSpine(bx, by, L.collarH, L.stalkL, pose);
            T.projectPoint(L, pose.pts[n * 3], pose.pts[n * 3 + 1], pose.pts[n * 3 + 2], out, 0);
            return out[1];
        };
        const upright = tipScreenY(0, 0);
        expect(tipScreenY(0, 0.8)).toBeGreaterThan(upright + 10); // toward: top moves down
        expect(tipScreenY(0, -0.8)).toBeLessThan(upright); // away: top moves up
        // Upright, the nub is tall within the box and inside it.
        T.projectPoint(L, 0, 0, 0, out, 0);
        expect(out[1] - upright).toBeGreaterThan(160 * 0.3);
        expect(upright).toBeGreaterThan(0);
    });

    it("never twists the cap: the frame is the world frame upright and is orthonormal when bent", () => {
        const f = new Float64Array(9);
        for (const [dx, dz] of [[1, 0], [0, 1], [-0.6, 0.8]]) {
            T.capFrame(dx, dz, 0, f);
            [0, 1, 0, 1, 0, 0, 0, 0, 1].forEach((v, i) => expect(f[i]).toBeCloseTo(v, 9));
        }
        T.capFrame(0.6, -0.8, 0.9, f);
        const dot = (i: number, j: number) => f[i] * f[j] + f[i + 1] * f[j + 1] + f[i + 2] * f[j + 2];
        for (const i of [0, 3, 6]) expect(dot(i, i)).toBeCloseTo(1, 9);
        expect(dot(0, 3)).toBeCloseTo(0, 9);
        expect(dot(0, 6)).toBeCloseTo(0, 9);
        expect(dot(3, 6)).toBeCloseTo(0, 9);
        // Swinging through upright (bend direction flips) keeps the frame continuous.
        const a = [...T.capFrame(1, 0, 0.01, f)];
        const b = [...T.capFrame(-1, 0, 0.01, f)];
        for (let i = 0; i < 9; i++) expect(Math.abs(a[i] - b[i])).toBeLessThan(0.03);
    });

    it("reads light and dark themes from the foreground token", () => {
        expect(T.colorLightness("#000")).toBeCloseTo(0, 6);
        expect(T.colorLightness("#f1f2f2")).toBeGreaterThan(0.9);
        expect(T.colorLightness("oklch(0.129 0.042 264.695)")).toBeCloseTo(0.129, 6);
        expect(T.colorLightness("rgb(255, 255, 255)")).toBeCloseTo(1, 6);
        expect(T.colorLightness("hsl(0 0% 40%)")).toBeCloseTo(0.4, 6);
        expect(T.colorLightness("var(--x)")).toBeNull();
        expect(T.paletteFor({ ...DEFAULT_POINTING_VIZ_THEME, foreground: "#f1f2f2" }).dark).toBe(true);
        expect(T.paletteFor({ ...DEFAULT_POINTING_VIZ_THEME, foreground: "oklch(0.129 0.042 264.695)" }).dark).toBe(false);
    });

    it("draws every mode, squish and idle through a canvas context without throwing", () => {
        const calls: string[] = [];
        const ctx = stubCtx(calls);
        for (const mode of ["pointer", "scroll", "precision", "boost"] as const) {
            for (const size of [60, 100, 220]) {
                const st = T.createState();
                const now = hold(st, { mode, dx: 40, dy: -30, buttons: 1 }, 0, 300);
                calls.length = 0;
                expect(() => T.draw(ctx, st, DEFAULT_POINTING_VIZ_THEME, size, size, now, true)).not.toThrow();
                expect(calls).toContain("clearRect");
                expect(calls).toContain("fill");
            }
        }
        const idle = T.createState();
        expect(() => T.draw(ctx, idle, { ...DEFAULT_POINTING_VIZ_THEME, foreground: "#f1f2f2" }, 60, 60, 0, false)).not.toThrow();
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
