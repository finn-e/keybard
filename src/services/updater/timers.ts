// Timers for the firmware update that keep time in a background tab.
//
// Chrome clamps a hidden tab's main-thread timers: at least 1 s, and after five minutes
// hidden, chained timers wake once a minute. The update's waits (status polls at 250 ms,
// the reconnect loop, each request's reply timeout) would stretch from seconds to minutes.
// A dedicated worker's timers aren't clamped, so the update schedules its waits there and
// gets a message back on time. The send loop itself waits on each reply, never on a timer.
//
// Where a worker can't start (Keybard Paranoid's policy forbids workers, tests have none),
// the page's own timers are used, as before.

export interface UpdaterTimers {
    setTimeout(fn: () => void, ms: number): number;
    clearTimeout(id: number): void;
    /** Whether the waits run on a worker (false: the page's timers). */
    readonly unthrottled: boolean;
}

/** What a worker needs to be for the scheduler: posts timer ids back. */
export interface TimerWorker {
    postMessage(message: { id: number; ms?: number; cancel?: boolean }): void;
    onmessage: ((event: { data: number }) => void) | null;
    onerror: ((event: unknown) => void) | null;
    terminate(): void;
}

const WORKER_SOURCE = `
const timers = new Map();
onmessage = (e) => {
    const { id, ms, cancel } = e.data;
    if (cancel) { clearTimeout(timers.get(id)); timers.delete(id); return; }
    timers.set(id, setTimeout(() => { timers.delete(id); postMessage(id); }, ms));
};
`;

function startWorker(): TimerWorker | null {
    if (typeof Worker === "undefined" || typeof Blob === "undefined" || typeof URL === "undefined" || !URL.createObjectURL) return null;
    try {
        const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }));
        const worker = new Worker(url);
        URL.revokeObjectURL(url);
        return worker as unknown as TimerWorker;
    } catch {
        return null; // blocked by the page's policy
    }
}

/** The page's own timers. */
export function pageTimers(): UpdaterTimers {
    return {
        setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms) as unknown as number,
        clearTimeout: (id) => globalThis.clearTimeout(id as unknown as ReturnType<typeof setTimeout>),
        unthrottled: false,
    };
}

/**
 * Timers on a worker, falling back to the page's timers if it can't start or fails later.
 * A timer pending when the worker fails is moved to the page's timers with the time left.
 */
export function workerTimers(make: () => TimerWorker | null = startWorker, page: UpdaterTimers = pageTimers()): UpdaterTimers {
    let worker = make();
    if (!worker) return page;
    let nextId = 1;
    const pending = new Map<number, { fn: () => void; due: number; pageId?: number }>();
    const fallBack = () => {
        if (!worker) return;
        try { worker.terminate(); } catch { /* already gone */ }
        worker = null;
        for (const [id, t] of pending) t.pageId = page.setTimeout(() => { pending.delete(id); t.fn(); }, Math.max(0, t.due - Date.now()));
    };
    worker.onmessage = (e) => {
        const t = pending.get(e.data);
        if (!t || t.pageId !== undefined) return;
        pending.delete(e.data);
        t.fn();
    };
    worker.onerror = fallBack;
    return {
        get unthrottled() { return worker !== null; },
        setTimeout(fn, ms) {
            const id = nextId++;
            const t: { fn: () => void; due: number; pageId?: number } = { fn, due: Date.now() + ms };
            pending.set(id, t);
            if (worker) {
                try { worker.postMessage({ id, ms }); return id; } catch { fallBack(); return id; }
            }
            t.pageId = page.setTimeout(() => { pending.delete(id); fn(); }, ms);
            return id;
        },
        clearTimeout(id) {
            const t = pending.get(id);
            if (!t) return;
            pending.delete(id);
            if (t.pageId !== undefined) page.clearTimeout(t.pageId);
            else if (worker) { try { worker.postMessage({ id, cancel: true }); } catch { /* it won't fire: not pending */ } }
        },
    };
}

let shared: UpdaterTimers | null = null;

/** The update's timers, started on first use. */
export function updaterTimers(): UpdaterTimers {
    return (shared ??= workerTimers());
}

/** Wait on the update's timers. */
export function updaterSleep(ms: number, timers: UpdaterTimers = updaterTimers()): Promise<void> {
    return new Promise((resolve) => { timers.setTimeout(resolve, ms); });
}
