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

describe('TrackballFlowViz math', () => {
    it('smoothing approaches the target with a 120 ms time constant', () => {
        expect(T.smoothingAlpha(0)).toBe(0);
        expect(T.smoothingAlpha(120)).toBeCloseTo(1 - Math.exp(-1), 6);
        const s = T.createFlowState();
        T.ingestSample(s, { ...sample('pointer'), dx: 66, dy: 0, dtMs: 33 }, 0);
        T.stepFlow(s, 16, 16);
        // One 16 ms frame moves 1 - e^(-16/120) ~ 12.5% of the way to 2 counts/ms.
        expect(s.vx).toBeCloseTo(2 * T.smoothingAlpha(16), 6);
        let t = 32;
        for (; t < 600; t += 16) {
            T.ingestSample(s, { ...sample('pointer', t), dx: 66, dy: 0, dtMs: 33 }, t);
            T.stepFlow(s, t, 16);
        }
        expect(s.vx).toBeCloseTo(2, 1);
        expect(s.vy).toBeCloseTo(0, 6);
    });

    it('relaxes back to zero when samples go stale and eases to idle', () => {
        const s = T.createFlowState();
        let t = 0;
        for (; t < 500; t += 16) {
            T.ingestSample(s, { ...sample('pointer', t), dx: 60, dy: 30 }, t);
            T.stepFlow(s, t, 16);
        }
        expect(s.activity).toBe(1);
        expect(s.mag).toBeGreaterThan(0.3);
        for (; t < 500 + POINTING_IDLE_MS + 600; t += 16) T.stepFlow(s, t, 16);
        expect(Math.hypot(s.vx, s.vy)).toBeLessThan(1e-3);
        expect(s.activity).toBe(0);
        expect(T.isSettled(s, t)).toBe(true);
    });

    it('saturated samples draw at full magnitude', () => {
        const s = T.createFlowState();
        T.ingestSample(s, { ...sample('pointer'), dx: 1, dy: 0, saturated: true }, 0);
        T.stepFlow(s, 16, 16);
        expect(s.mag).toBe(1);
    });

    it('pointer field follows the ball direction and is fastest at the centre', () => {
        const s = T.createFlowState();
        T.ingestSample(s, { ...sample('pointer'), dx: 100, dy: 0 }, 0);
        for (let t = 0; t < 400; t += 16) T.stepFlow(s, t, 16);
        const c = { x: 0, y: 0 };
        const rim = { x: 0, y: 0 };
        T.fieldAt(s, 0, 0, c);
        T.fieldAt(s, 0, 0.95, rim);
        expect(c.x).toBeGreaterThan(Math.abs(c.y));
        expect(c.x).toBeGreaterThan(rim.x);
    });

    it('precision halves the particle count and the field speed', () => {
        expect(T.activeParticleCount('pointer')).toBe(T.MAX_PARTICLES);
        expect(T.activeParticleCount('precision')).toBe(T.MAX_PARTICLES / 2);
        const a = T.createFlowState();
        const b = T.createFlowState();
        for (const [s, mode] of [[a, 'pointer'], [b, 'precision']] as const) {
            T.ingestSample(s, { ...sample(mode), dx: 50, dy: 0 }, 0);
            for (let t = 0; t < 400; t += 16) T.stepFlow(s, t, 16);
            s.noiseT = 0;
        }
        b.vx = a.vx;
        b.vy = a.vy;
        b.mag = a.mag;
        const fa = { x: 0, y: 0 };
        const fb = { x: 0, y: 0 };
        T.fieldAt(a, 0.1, 0.1, fa);
        T.fieldAt(b, 0.1, 0.1, fb);
        expect(fb.x).toBeCloseTo(fa.x * 0.5, 1);
    });

    it('scroll streams along one axis only, honouring axis lock and natural scroll', () => {
        const s = T.createFlowState();
        T.ingestSample(s, { ...sample('scroll'), dx: 10, dy: 40, axisLock: 'vertical' }, 0);
        for (let t = 0; t < 400; t += 16) T.stepFlow(s, t, 16);
        const f = { x: 0, y: 0 };
        T.fieldAt(s, 0.3, -0.2, f);
        expect(f.x).toBe(0);
        expect(f.y).toBeGreaterThan(0);

        const base = sample('scroll');
        expect(T.scrollAxisOf({ ...base, dx: 50, dy: 5, axisLock: 'free' })).toBe('horizontal');
        expect(T.scrollAxisOf({ ...base, dx: 50, dy: 5, axisLock: 'vertical' })).toBe('vertical');
        expect(T.scrollAxisOf({ ...base, dx: 5, dy: 50, axisLock: 'horizontal' })).toBe('horizontal');
        expect(T.scrollAxisOf({ ...base, dx: 0, dy: 0, h: 0, v: 0, axisLock: 'free' })).toBeNull();

        // Wheel units win over dx/dy; +v (up) draws upward (negative y).
        expect(T.scrollRateOf({ ...base, dy: 40, v: 2, dtMs: 33 }, 'vertical')).toBeLessThan(0);
        expect(T.scrollRateOf({ ...base, dy: 40, v: 0, dtMs: 33 }, 'vertical')).toBeCloseTo(40 / 33, 6);
        expect(T.scrollRateOf({ ...base, dy: 40, v: 0, dtMs: 33, naturalScroll: true }, 'vertical')).toBeCloseTo(-40 / 33, 6);
        expect(T.scrollRateOf({ ...base, dx: 0, h: 3, dtMs: 33 }, 'horizontal')).toBeGreaterThan(0);
    });

    it('boost entry fires one pulse; buttons fire a flash', () => {
        const s = T.createFlowState();
        T.ingestSample(s, sample('pointer', 0), 0);
        expect(s.pulseMs).toBe(0);
        T.ingestSample(s, sample('boost', 33), 33);
        expect(s.pulseMs).toBe(T.PULSE_MS);
        T.stepFlow(s, 100, 67);
        const left = s.pulseMs;
        T.ingestSample(s, sample('boost', 133), 133);
        expect(s.pulseMs).toBe(left); // staying in boost does not re-fire
        T.ingestSample(s, { ...sample('pointer', 166), buttons: 1 }, 166);
        expect(s.flashMs).toBe(T.FLASH_MS);
    });

    it('trail length grows with magnitude and differs per mode', () => {
        expect(T.trailLength('pointer', 1, 0.8)).toBeGreaterThan(T.trailLength('pointer', 1, 0.1));
        expect(T.trailLength('boost', 1, 0.5) - 0.04).toBeCloseTo(2 * (T.trailLength('pointer', 1, 0.5) - 0.04), 6);
        expect(T.trailLength('precision', 1, 0.5)).toBeLessThan(T.trailLength('pointer', 1, 0.5));
        expect(T.trailLength('scroll', 1, 1)).toBeGreaterThan(T.trailLength('scroll', 1, 0));
    });

    it('particles stay inside the disk while advecting in every mode', () => {
        for (const mode of ['pointer', 'scroll', 'precision', 'boost'] as const) {
            const s = T.createFlowState(5);
            let t = 0;
            for (let k = 0; k < 200; k++, t += 16) {
                T.ingestSample(s, simulateSample('trackball', 'left', t * 3, { mode }), t);
                T.stepFlow(s, t, 16);
                for (let i = 0; i < T.activeParticleCount(mode); i++) {
                    expect(Math.hypot(s.px[i], s.py[i])).toBeLessThanOrEqual(1.0001);
                }
            }
            expect(s.activity).toBe(1);
        }
    });

    it('particle alpha fades in and out', () => {
        expect(T.particleAlpha(0, 3)).toBe(0);
        expect(T.particleAlpha(1, 3)).toBe(1);
        expect(T.particleAlpha(3, 3)).toBe(0);
    });

    it('static glyph shows direction and magnitude per mode', () => {
        expect(T.staticGlyph(null).mode).toBe('idle');
        expect(T.staticGlyph(sample('idle')).mode).toBe('idle');
        const g = T.staticGlyph({ ...sample('pointer'), dx: 0, dy: -50 });
        expect(g.uy).toBe(-1);
        expect(g.mag).toBeGreaterThan(0);
        const sc = T.staticGlyph({ ...sample('scroll'), dx: 60, dy: 0, h: 0, v: 0, axisLock: 'free' });
        expect(sc.mode).toBe('scroll');
        expect(sc.axis).toBe('horizontal');
        expect(sc.ux).toBe(1);
    });

    it('draw functions run on a stub context for every mode at 60 and 140 px', () => {
        const { ctx, calls } = fakeContext();
        for (const size of [60, 140]) {
            for (const mode of ['idle', 'pointer', 'scroll', 'precision', 'boost'] as const) {
                const s = T.createFlowState();
                let t = 0;
                for (let k = 0; k < 20; k++, t += 16) {
                    T.ingestSample(s, simulateSample('trackball', 'left', 500 + t, { mode }), t);
                    T.stepFlow(s, t, 16);
                }
                s.flashMs = T.FLASH_MS;
                expect(() => T.drawFlowFrame(ctx, s, size, size, DEFAULT_POINTING_VIZ_THEME)).not.toThrow();
                expect(() => T.drawStaticFrame(ctx, s.lastSample, size, size, DEFAULT_POINTING_VIZ_THEME)).not.toThrow();
            }
        }
        expect(calls.stroke).toBeGreaterThan(0);
    });
});
