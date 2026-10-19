// One poller for POINTING_MOTION (0x2D), shared by everything on the page that
// draws live pointing. Each read returns and clears the motion both hands made
// since the last read, so there is only ever one reader in this page. It polls
// only while something holds it, the board advertises 0x2D, and the tab is
// visible (in Keybard Paranoid, also focused). It only reads; it never writes.

import { PARANOID, userIsLooking } from "@/lib/paranoid";
import { keyboardService } from "@/services/keyboard.service";
import type { KeyboardInfo } from "@/types/keyboard.types";
import type { PointingMotionReport } from "@/utils/pointing-motion";

/** Delay between the end of one read and the start of the next. */
export const POINTING_LIVE_INTERVAL_MS = 16;
/** Delay after POINTING_LIVE_MAX_MISSES consecutive empty or failed reads. */
export const POINTING_LIVE_BACKOFF_MS = 1000;
export const POINTING_LIVE_MAX_MISSES = 3;
/** Delay once POINTING_LIVE_QUIET_READS reads in a row carried no motion; motion returns to the fast rate. */
export const POINTING_LIVE_QUIET_MS = 100;
export const POINTING_LIVE_QUIET_READS = 30;

/** What the poller needs from the app; injectable for tests. */
export interface PointingLiveDeps {
    getPointingMotion(kbinfo: KeyboardInfo): Promise<PointingMotionReport | null>;
    hasPointingMotion(kbinfo: KeyboardInfo | null | undefined): boolean;
    now(): number;
}

export type PointingReportListener = (report: PointingMotionReport, dtMs: number) => void;

export class PointingLiveService {
    private refs = 0;
    private kbinfo: KeyboardInfo | null = null;
    private connected = false;
    private sessionId: number | null = null;
    private listeners = new Set<PointingReportListener>();
    private timer: ReturnType<typeof setTimeout> | undefined;
    private looping = false;
    private inFlight = false;
    private generation = 0;
    private misses = 0;
    private quietReads = 0;
    private lastReadAt: number | null = null;
    private listening = false;
    private last: PointingMotionReport | null = null;

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

    subscribe(listener: PointingReportListener): () => void {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }

    /** The last report read, for the modes (sniper, boost) between motions. */
    latest(): PointingMotionReport | null {
        return this.last;
    }

    reset() {
        this.generation++;
        this.stop();
        this.misses = 0;
        this.quietReads = 0;
        this.lastReadAt = null;
        this.last = null;
    }

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
        if (this.looping || this.inFlight || !this.canPoll()) return;
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
        this.inFlight = true;
        try {
            report = await this.deps.getPointingMotion(this.kbinfo);
        } catch {
            report = null;
        } finally {
            this.inFlight = false;
        }
        if (generation === this.generation) this.take(report);
        if (!this.canPoll()) {
            this.stop();
            return;
        }
        this.schedule(this.nextDelay());
    }

    private nextDelay(): number {
        if (this.misses >= POINTING_LIVE_MAX_MISSES) return POINTING_LIVE_BACKOFF_MS;
        if (this.quietReads >= POINTING_LIVE_QUIET_READS) return POINTING_LIVE_QUIET_MS;
        return POINTING_LIVE_INTERVAL_MS;
    }

    private take(report: PointingMotionReport | null) {
        const now = this.deps.now();
        const fallbackDt = this.lastReadAt === null ? POINTING_LIVE_INTERVAL_MS : Math.max(1, now - this.lastReadAt);
        this.lastReadAt = now;
        if (!report) { this.misses++; return; }
        this.misses = 0;
        const moved = (["left", "right"] as const).some((side) => report[side].dx !== 0 || report[side].dy !== 0 || (report[side].contacts?.length ?? 0) > 0);
        this.quietReads = moved ? 0 : this.quietReads + 1;
        this.last = report;
        for (const l of [...this.listeners]) {
            try { l(report, report.elapsedMs || fallbackDt); } catch (e) { console.warn("Pointing listener failed:", e); }
        }
    }

    private listen() {
        if (this.listening || typeof document === "undefined") return;
        this.listening = true;
        document.addEventListener("visibilitychange", () => { if (document.hidden) this.stop(); else this.kick(); });
        if (typeof window !== "undefined") window.addEventListener("focus", () => this.kick());
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
