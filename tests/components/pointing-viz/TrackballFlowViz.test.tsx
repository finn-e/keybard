import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { TrackballFlowViz, _testTrackball as T } from '../../../src/components/pointing-viz/TrackballFlowViz';
import { simulateSample } from '../../../src/components/pointing-viz/simulate';
import {
    DEFAULT_POINTING_VIZ_THEME,
    POINTING_IDLE_MS,
    type PointingLiveSample,
    type PointingMode,
    type PointingSampleSource,
} from '../../../src/components/pointing-viz/types';

/** A hand-driven source built from simulateSample. */
function fakeSource(first: PointingLiveSample | null) {
    let last = first;
    const listeners = new Set<(s: PointingLiveSample) => void>();
    const unsub = vi.fn();
    const src: PointingSampleSource & { push(s: PointingLiveSample): void; unsub: typeof unsub; count(): number } = {
        latest: () => last,
        subscribe(l) {
            listeners.add(l);
            return () => {
                unsub();
                listeners.delete(l);
            };
        },
        push(s) {
            last = s;
            for (const l of listeners) l(s);
        },
        unsub,
        count: () => listeners.size,
    };
    return src;
}

/** Records canvas calls; every method is a no-op. */
function fakeContext() {
    const calls: Record<string, number> = {};
    const target: Record<string, unknown> = {};
    return {
        calls,
        ctx: new Proxy(target, {
            get(t, key: string) {
                if (key in t) return t[key];
                return (..._args: unknown[]) => {
                    calls[key] = (calls[key] ?? 0) + 1;
                    if (key === 'createRadialGradient' || key === 'createLinearGradient') return { addColorStop: () => {} };
                };
            },
            set(t, key: string, value) {
                t[key] = value;
                return true;
            },
        }) as unknown as CanvasRenderingContext2D,
    };
}

const sample = (mode: PointingMode | 'idle', t = 1000, extra: Partial<PointingLiveSample> = {}): PointingLiveSample => ({
    ...simulateSample('trackball', 'left', t, { mode }),
    ...extra,
});

const props = (source: PointingSampleSource, reducedMotion = false) => ({
    source,
    side: 'left' as const,
    width: 92,
    height: 92,
    reducedMotion,
    theme: DEFAULT_POINTING_VIZ_THEME,
    sensor: 'pmw3360' as const,
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('TrackballFlowViz component', () => {
    it('renders without throwing under jsdom (no 2D context) with a labelled wrapper', () => {
        const src = fakeSource(sample('pointer'));
        render(<TrackballFlowViz {...props(src)} />);
        const el = screen.getByRole('img');
        expect(el.getAttribute('aria-label')).toBe('Left trackball');
        expect(el.querySelector('canvas')?.getAttribute('aria-hidden')).toBe('true');
    });

    it('labels the right hand', () => {
        const src = fakeSource(null);
        render(<TrackballFlowViz {...props(src)} side="right" />);
        expect(screen.getByRole('img').getAttribute('aria-label')).toMatch(/Right.*trackball/);
    });

    it('unsubscribes and cancels its animation frame on unmount', () => {
        const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 42);
        const caf = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
        const src = fakeSource(sample('pointer'));
        const { unmount } = render(<TrackballFlowViz {...props(src)} />);
        expect(raf).toHaveBeenCalled();
        expect(src.count()).toBe(1);
        unmount();
        expect(src.unsub).toHaveBeenCalledTimes(1);
        expect(caf).toHaveBeenCalledWith(42);
    });

    it('schedules no animation frame under reduced motion and redraws a still frame per sample', () => {
        vi.useFakeTimers();
        try {
            const raf = vi.spyOn(window, 'requestAnimationFrame');
            const { ctx, calls } = fakeContext();
            vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
            const src = fakeSource(sample('pointer'));
            const { unmount } = render(<TrackballFlowViz {...props(src, true)} />);
            const firstClears = calls.clearRect ?? 0;
            expect(firstClears).toBe(1);
            act(() => {
                vi.advanceTimersByTime(300);
                src.push(sample('scroll', 1300));
            });
            expect(calls.clearRect).toBe(2);
            // Throttled: a burst within 250 ms collapses into one trailing redraw.
            act(() => {
                src.push(sample('scroll', 1310));
                src.push(sample('scroll', 1320));
            });
            expect(calls.clearRect).toBe(2);
            act(() => {
                vi.advanceTimersByTime(260);
            });
            expect(calls.clearRect).toBe(3);
            expect(raf).not.toHaveBeenCalled();
            unmount();
            expect(src.unsub).toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it('draws animated frames with a stubbed context and sleeps once idle', () => {
        const queue: FrameRequestCallback[] = [];
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
            queue.push(cb);
            return queue.length;
        });
        vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
        const { ctx, calls } = fakeContext();
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
        // No motion: first frame draws the idle image and the loop stops.
        const src = fakeSource(sample('idle'));
        render(<TrackballFlowViz {...props(src)} />);
        expect(queue.length).toBe(1);
        act(() => queue.shift()!(0));
        expect(calls.clearRect).toBe(1);
        expect(queue.length).toBe(0);
        // A moving sample wakes it.
        act(() => src.push(sample('pointer', 2000)));
        expect(queue.length).toBe(1);
        act(() => queue.shift()!(0));
        expect(calls.clearRect).toBe(2);
        expect(queue.length).toBe(1);
    });
});

describe('TrackballFlowViz sphere', () => {
    const near = (s: ReturnType<typeof T.createBallState>, i: number) => {
        const v = { x: 0, y: 0, z: 0 };
        T.dotInView(s, i, v);
        return v;
    };
    /** Roll the ball with a steady sample for `ms`. */
    const roll = (s: ReturnType<typeof T.createBallState>, smp: PointingLiveSample, ms: number) => {
        let t = 0;
        for (; t < ms; t += 16) {
            T.ingestSample(s, { ...smp, t }, t);
            T.stepBall(s, t, 16);
        }
        return t;
    };

    it('spreads the dots evenly over the whole sphere, as unit vectors', () => {
        const d = T.fibonacciSphere(T.DOT_COUNT);
        let sx = 0, sy = 0, sz = 0;
        for (let i = 0; i < T.DOT_COUNT; i++) {
            const [x, y, z] = [d[i * 3], d[i * 3 + 1], d[i * 3 + 2]];
            expect(Math.hypot(x, y, z)).toBeCloseTo(1, 5);
            sx += x; sy += y; sz += z;
        }
        // Evenly spread: the centroid sits at the centre.
        expect(Math.hypot(sx, sy, sz) / T.DOT_COUNT).toBeLessThan(0.02);
    });

    it('rolls the near face in the direction of motion', () => {
        const s = T.createBallState();
        s.rot.set([1, 0, 0, 0, 1, 0, 0, 0, 1]);
        s.dots = new Float32Array([0, 0, 1]); // one dot facing the viewer
        roll(s, { ...sample('pointer'), dx: 40, dy: 0, dtMs: 33 }, 200);
        const v = near(s, 0);
        expect(v.x).toBeGreaterThan(0.1); // moved right
        expect(Math.abs(v.y)).toBeLessThan(1e-6);
        expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(1, 6); // still on the sphere
    });

    it('keeps the orientation a rotation over a long roll', () => {
        const s = T.createBallState('right');
        roll(s, { ...sample('boost'), dx: 70, dy: -45, dtMs: 33 }, 20000);
        const r = s.rot;
        for (const [a, b] of [[0, 3], [0, 6], [3, 6]]) {
            expect(r[a] * r[b] + r[a + 1] * r[b + 1] + r[a + 2] * r[b + 2]).toBeCloseTo(0, 6);
        }
        for (const a of [0, 3, 6]) expect(Math.hypot(r[a], r[a + 1], r[a + 2])).toBeCloseTo(1, 6);
    });

    it('rolls slower in precision and faster in boost for the same motion', () => {
        const turned = (mode: PointingMode) => {
            const s = T.createBallState();
            s.rot.set([1, 0, 0, 0, 1, 0, 0, 0, 1]);
            s.dots = new Float32Array([0, 0, 1]);
            roll(s, { ...sample(mode), dx: 30, dy: 0, dtMs: 33 }, 150);
            return Math.acos(near(s, 0).z);
        };
        expect(turned('precision')).toBeLessThan(turned('pointer'));
        expect(turned('boost')).toBeGreaterThan(turned('pointer'));
    });

    it('scroll rolls along its axis only, honouring axis lock and natural scroll', () => {
        const base = { ...sample('scroll'), dtMs: 33, h: 0, v: 0 };
        expect(T.targetVelocity({ ...base, dx: 30, dy: 20, axisLock: 'free' }, 'horizontal')).toEqual({ x: 30 / 33, y: 0 });
        expect(T.targetVelocity({ ...base, dx: 30, dy: 20, axisLock: 'free' }, 'vertical')).toEqual({ x: 0, y: 20 / 33 });
        expect(T.targetVelocity({ ...base, dx: 0, dy: 20, naturalScroll: true }, 'vertical').y).toBeCloseTo(-20 / 33, 9);
        // Wheel units from the driver: +v is up.
        expect(T.targetVelocity({ ...base, dx: 0, dy: 0, v: 2 }, 'vertical').y).toBeLessThan(0);
        const s = T.createBallState();
        T.ingestSample(s, { ...base, dx: 50, dy: 5, axisLock: 'vertical' }, 0);
        expect(s.axis).toBe('vertical');
        T.ingestSample(s, { ...base, dx: 50, dy: 5, axisLock: 'free' }, 0);
        expect(s.axis).toBe('horizontal');
    });

    it('comes to rest once samples go stale, and settles', () => {
        const s = T.createBallState();
        const t = roll(s, { ...sample('pointer'), dx: 40, dy: 10, dtMs: 33 }, 300);
        expect(T.isSettled(s, t)).toBe(false);
        for (let k = t; k < t + 3000; k += 16) T.stepBall(s, k, 16);
        expect(T.isSettled(s, t + 3000)).toBe(true);
        expect(T.rollSpeed(s)).toBeLessThan(0.01);
    });

    it('boost entry fires one pulse; buttons fire a flash', () => {
        const s = T.createBallState();
        T.ingestSample(s, sample('pointer'), 0);
        T.ingestSample(s, sample('boost'), 10);
        expect(s.pulseMs).toBe(T.PULSE_MS);
        s.pulseMs = 0;
        T.ingestSample(s, sample('boost'), 20);
        expect(s.pulseMs).toBe(0);
        T.ingestSample(s, { ...sample('pointer'), buttons: 1 }, 30);
        expect(s.flashMs).toBe(T.FLASH_MS);
    });

    it('draws every mode, animated and still, on a stub context at 60 and 140 px', () => {
        const { ctx, calls } = fakeContext();
        for (const size of [60, 140]) {
            for (const mode of ['idle', 'pointer', 'scroll', 'precision', 'boost'] as const) {
                const s = T.createBallState();
                roll(s, sample(mode), 320);
                s.flashMs = T.FLASH_MS;
                expect(() => T.drawBallFrame(ctx, s, size, size, DEFAULT_POINTING_VIZ_THEME, 500)).not.toThrow();
                expect(() => T.drawStaticFrame(ctx, T.createBallState(), sample(mode, 900), size, size, DEFAULT_POINTING_VIZ_THEME)).not.toThrow();
            }
        }
        expect(calls.ellipse).toBeGreaterThan(0);
        expect(calls.createRadialGradient).toBeGreaterThan(0);
    });
});
