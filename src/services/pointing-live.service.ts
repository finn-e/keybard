// One poller for POINTING_MOTION (0x2D), shared by every pointing slot on the
// page. Each read returns and clears the motion both hands made since the last
// read, so there must only ever be one reader. See docs/pointing-fragments-spec.md (C4).

import type { PointingLiveSample, PointingSampleSource, PointingSide } from "@/components/pointing-viz/types";
import { PARANOID, userIsLooking } from "@/lib/paranoid";
import { keyboardService } from "@/services/keyboard.service";
import type { KeyboardInfo } from "@/types/keyboard.types";
import { toLiveSample, type PointingMotionReport } from "@/utils/pointing-motion";

/** Delay between the end of one read and the start of the next. */
export const POINTING_LIVE_INTERVAL_MS = 33;
/** Delay after POINTING_LIVE_MAX_MISSES consecutive empty or failed reads. */
export const POINTING_LIVE_BACKOFF_MS = 1000;
export const POINTING_LIVE_MAX_MISSES = 3;

/** What the poller needs from the app; injectable for tests. */
export interface PointingLiveDeps {
    getPointingMotion(kbinfo: KeyboardInfo): Promise<PointingMotionReport | null>;
    hasPointingMotion(kbinfo: KeyboardInfo | null | undefined): boolean;
    now(): number;
}

class LiveSource implements PointingSampleSource {
    private last: PointingLiveSample | null = null;
    private listeners = new Set<(s: PointingLiveSample) => void>();

    latest(): PointingLiveSample | null {
        return this.last;
    }

    subscribe(listener: (s: PointingLiveSample) => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    push(sample: PointingLiveSample) {
        this.last = sample;
        for (const l of [...this.listeners]) {
            try {
                l(sample);
            } catch (e) {
                console.warn("Pointing slot listener failed:", e);
            }
        }
    }

    clear() {
        this.last = null;
    }
}

export class PointingLiveService {
    private refs = 0;
    private kbinfo: KeyboardInfo | null = null;
    private connected = false;
    private sessionId: number | null = null;
    private readonly sources: Record<PointingSide, LiveSource> = { left: new LiveSource(), right: new LiveSource() };
    private timer: ReturnType<typeof setTimeout> | undefined;
    /** A read is scheduled or in flight. */
    private looping = false;
    /** Bumped by reset() so a read in flight from an old connection is dropped. */
    private generation = 0;
    private misses = 0;
    private lastReadAt: number | null = null;
    private listening = false;

    constructor(private deps: PointingLiveDeps) {}

    /** Keeps the poller pointed at the current board. A new session or a disconnect resets it. */
    setConnection(kbinfo: KeyboardInfo | null, connected: boolean, sessionId: number) {
        const changed = this.sessionId !== sessionId || (this.connected && !connected);
        this.kbinfo = kbinfo;
        if (changed) this.reset();
        this.connected = connected;
        this.sessionId = sessionId;
        this.kick();
    }

    /** Polling runs while at least one caller holds it. Returns the release function (safe to call twice). */
    acquire(): () => void {
        this.refs++;
        this.listen();
        this.kick();
        let released = false;
        return () => {
            if (released) return;
            released = true;
            this.refs = Math.max(0, this.refs - 1);
            if (this.refs === 0) this.stop();
        };
    }

    /** The live stream for one hand: the same object for the life of the page. */
    source(side: PointingSide): PointingSampleSource {
        return this.sources[side];
    }

    /** Forgets the samples and the read state (disconnect, new session). */
    reset() {
        this.generation++;
        this.stop();
        this.misses = 0;
        this.lastReadAt = null;
        this.sources.left.clear();
        this.sources.right.clear();
    }

    /** For tests. */
    get isPolling(): boolean {
        return this.looping;
    }

    private canPoll(): boolean {
        if (this.refs <= 0 || !this.connected || !this.kbinfo) return false;
        if (typeof document !== "undefined" && document.hidden) return false;
        if (PARANOID && !userIsLooking()) return false;
        return this.deps.hasPointingMotion(this.kbinfo);
    }

    private stop() {
        if (this.timer !== undefined) clearTimeout(this.timer);
        this.timer = undefined;
        this.looping = false;
        this.lastReadAt = null;
    }

    private kick() {
        if (this.looping || !this.canPoll()) return;
        this.schedule(0);
    }

    private schedule(delay: number) {
        this.looping = true;
        this.timer = setTimeout(() => {
            this.timer = undefined;
            void this.tick();
        }, delay);
    }

    private async tick() {
        if (!this.canPoll() || !this.kbinfo) {
            this.stop();
            return;
        }
        const generation = this.generation;
        let report: PointingMotionReport | null = null;
        try {
            report = await this.deps.getPointingMotion(this.kbinfo);
        } catch {
            report = null;
        }
        if (generation !== this.generation || !this.looping) return;

        const now = this.deps.now();
        const fallbackDt = this.lastReadAt === null ? POINTING_LIVE_INTERVAL_MS : Math.max(1, now - this.lastReadAt);
        this.lastReadAt = now;
        if (report) {
            this.misses = 0;
            for (const side of ["left", "right"] as const) {
                const sample = toLiveSample(report, side, now, fallbackDt);
                if (sample) this.sources[side].push(sample);
            }
        } else {
            this.misses++;
        }

        if (!this.canPoll()) {
            this.stop();
            return;
        }
        this.schedule(this.misses >= POINTING_LIVE_MAX_MISSES ? POINTING_LIVE_BACKOFF_MS : POINTING_LIVE_INTERVAL_MS);
    }

    private listen() {
        if (this.listening || typeof document === "undefined") return;
        this.listening = true;
        const resume = () => {
            if (document.hidden) this.stop();
            else this.kick();
        };
        document.addEventListener("visibilitychange", resume);
        // Paranoid also pauses while the window is unfocused.
        if (typeof window !== "undefined") {
            window.addEventListener("focus", () => this.kick());
        }
    }
}

let instance: PointingLiveService | null = null;
let depsOverride: PointingLiveDeps | null = null;

/** The app's poller. Created on first use. */
export function getPointingLive(): PointingLiveService {
    if (!instance) {
        instance = new PointingLiveService(
            depsOverride ?? {
                getPointingMotion: (kb) => keyboardService.getPointingMotion(kb),
                hasPointingMotion: (kb) => keyboardService.hasPointingMotion(kb),
                now: () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
            },
        );
    }
    return instance;
}

/** For tests: replace the singleton's dependencies (and drop the old instance). */
export function _setPointingLiveDepsForTest(deps: PointingLiveDeps | null) {
    instance?.reset();
    instance = null;
    depsOverride = deps;
}
