import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { PointingLiveService, POINTING_LIVE_BACKOFF_MS, POINTING_LIVE_INTERVAL_MS } from '../../src/services/pointing-live.service';
import type { PointingMotionReport, PointingMotionHalf } from '../../src/utils/pointing-motion';

const half = (o: Partial<PointingMotionHalf> = {}): PointingMotionHalf => ({
    valid: true, scrolling: false, saturated: false, autoMouse: false, touchValid: false, fingers: 0,
    dx: 0, dy: 0, h: 0, v: 0, buttons: 0, touchX: 0, touchY: 0, ...o,
});
const report = (left: Partial<PointingMotionHalf> = {}, right: Partial<PointingMotionHalf> = { valid: false }): PointingMotionReport => ({
    precision: false, boost: false, autoMouseLayer: false, axisLockEnabled: false, naturalScroll: false, scrollKey: false,
    elapsedMs: 0, axisLock: 'free', left: half(left), right: half(right),
});

const kb = { feature_flags2: 0x04 } as any;

describe('PointingLiveService', () => {
    let replies: (PointingMotionReport | null | Error)[];
    let getPointingMotion: ReturnType<typeof vi.fn>;
    let svc: PointingLiveService;
    let hidden = false;

    beforeEach(() => {
        vi.useFakeTimers();
        replies = [];
        getPointingMotion = vi.fn(async () => {
            const r = replies.length > 1 ? replies.shift()! : replies[0] ?? null;
            if (r instanceof Error) throw r;
            return r;
        });
        svc = new PointingLiveService({ getPointingMotion, hasPointingMotion: (k) => ((k?.feature_flags2 ?? 0) & 4) !== 0, now: () => Date.now() });
        hidden = false;
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    });
    afterEach(() => {
        svc.reset();
        vi.useRealTimers();
    });

    const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

    it('polls only while acquired and connected, 33 ms after each read finishes', async () => {
        replies.push(report({ dx: 3 }));
        svc.setConnection(kb, true, 1);
        await advance(100);
        expect(getPointingMotion).not.toHaveBeenCalled();

        const release = svc.acquire();
        await advance(0);
        expect(getPointingMotion).toHaveBeenCalledTimes(1);
        await advance(POINTING_LIVE_INTERVAL_MS);
        expect(getPointingMotion).toHaveBeenCalledTimes(2);
        await advance(POINTING_LIVE_INTERVAL_MS * 3);
        expect(getPointingMotion).toHaveBeenCalledTimes(5);

        release();
        release(); // safe twice
        await advance(500);
        expect(getPointingMotion).toHaveBeenCalledTimes(5);
        expect(svc.isPolling).toBe(false);
    });

    it('is refcounted: one loop for many holders', async () => {
        replies.push(report());
        svc.setConnection(kb, true, 1);
        const a = svc.acquire();
        const b = svc.acquire();
        await advance(POINTING_LIVE_INTERVAL_MS * 2);
        expect(getPointingMotion).toHaveBeenCalledTimes(3);
        a();
        await advance(POINTING_LIVE_INTERVAL_MS);
        expect(getPointingMotion).toHaveBeenCalledTimes(4);
        b();
        await advance(POINTING_LIVE_INTERVAL_MS * 3);
        expect(getPointingMotion).toHaveBeenCalledTimes(4);
    });

    it('never polls a board without the feature bit', async () => {
        svc.setConnection({ feature_flags2: 0x02 } as any, true, 1);
        svc.acquire();
        await advance(200);
        expect(getPointingMotion).not.toHaveBeenCalled();
    });

    it('pushes samples only for valid hands, to stable per-side sources', async () => {
        replies.push(report({ dx: 7, dy: -2 }, { valid: false, dx: 99 }));
        const left = svc.source('left');
        const right = svc.source('right');
        const seen = vi.fn();
        const unsubscribe = left.subscribe(seen);
        svc.setConnection(kb, true, 1);
        svc.acquire();
        await advance(0);
        expect(seen).toHaveBeenCalledTimes(1);
        expect(left.latest()).toMatchObject({ dx: 7, dy: -2, mode: 'pointer' });
        expect(right.latest()).toBeNull();
        expect(svc.source('left')).toBe(left);
        unsubscribe();
        await advance(POINTING_LIVE_INTERVAL_MS);
        expect(seen).toHaveBeenCalledTimes(1);
    });

    it('backs off to 1 s after three misses and returns to 33 ms on success', async () => {
        replies.push(null, new Error('timeout'), null, null, report());
        svc.setConnection(kb, true, 1);
        svc.acquire();
        await advance(0); // miss 1
        await advance(POINTING_LIVE_INTERVAL_MS); // miss 2
        await advance(POINTING_LIVE_INTERVAL_MS); // miss 3
        expect(getPointingMotion).toHaveBeenCalledTimes(3);
        await advance(POINTING_LIVE_BACKOFF_MS - 1);
        expect(getPointingMotion).toHaveBeenCalledTimes(3);
        await advance(1); // miss 4, still backed off
        expect(getPointingMotion).toHaveBeenCalledTimes(4);
        await advance(POINTING_LIVE_BACKOFF_MS); // success
        expect(getPointingMotion).toHaveBeenCalledTimes(5);
        await advance(POINTING_LIVE_INTERVAL_MS);
        expect(getPointingMotion).toHaveBeenCalledTimes(6);
    });

    it('pauses while the tab is hidden and resumes on visibilitychange', async () => {
        replies.push(report());
        svc.setConnection(kb, true, 1);
        svc.acquire();
        await advance(0);
        hidden = true;
        await advance(POINTING_LIVE_INTERVAL_MS);
        const calls = getPointingMotion.mock.calls.length;
        await advance(500);
        expect(getPointingMotion).toHaveBeenCalledTimes(calls);
        hidden = false;
        document.dispatchEvent(new Event('visibilitychange'));
        await advance(0);
        expect(getPointingMotion).toHaveBeenCalledTimes(calls + 1);
    });

    it('resets on disconnect and on a new session, dropping a read in flight', async () => {
        let resolve!: (r: PointingMotionReport) => void;
        getPointingMotion.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
        svc.setConnection(kb, true, 1);
        svc.acquire();
        await advance(0);
        svc.setConnection(kb, true, 2); // new session while the read is out
        resolve(report({ dx: 50 }));
        await advance(0);
        expect(svc.source('left').latest()).toBeNull();

        replies.push(report({ dx: 1 }));
        await advance(POINTING_LIVE_INTERVAL_MS);
        expect(svc.source('left').latest()).toMatchObject({ dx: 1 });

        svc.setConnection(kb, false, 2);
        expect(svc.source('left').latest()).toBeNull();
        const calls = getPointingMotion.mock.calls.length;
        await advance(300);
        expect(getPointingMotion).toHaveBeenCalledTimes(calls);
    });
});
