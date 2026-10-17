// Late pointing-module detection. The board retries its pointing probe after
// power-on (1.5, 3, 6, 12 and 30 s, then never again), so a module can show up
// after Keybard has read the board at connect. This is the one reader that
// keeps asking: it re-reads hardware detection (0x18) and POINTING_HARDWARE
// (0x2C) about every 2 s while a hand still shows "Detecting" or no module, for
// up to 35 s after connect, then stops for good. It stops for a hand once that
// hand reports a module, and stops altogether once every hand has one. It only
// reads; it never writes.
//
// What it finds goes back into the keyboard (fragmentState.hwDetection and
// pointing_hardware) through the caller's apply, which keeps it out of the
// unsaved edits: it's board state, not part of the layout.
//
// On firmware that never retries, the answers just never change: at most
// about 17 rounds of one or two reads, then nothing.

import { PARANOID, userIsLooking } from "@/lib/paranoid";
import { widgetInstanceIndices } from "@/services/fragment-composer.service";
import type { KeyboardInfo } from "@/types/keyboard.types";
import type { PointingHalfReport, PointingHardwareReport, Side } from "@/utils/pointing-hardware";

export const POINTING_DETECT_INTERVAL_MS = 2000;
/** The board's last probe is 30 s after power-on; connect comes after power-on, so this covers it. */
export const POINTING_DETECT_WINDOW_MS = 35000;

const NO_DETECTION = 0xff;

/** What the poller reads from the board; injectable for tests. */
export interface PointingDetectDeps {
    /** 0x18, fresh; null when the board has no fragments or the read failed. */
    readHardwareDetection(kbinfo: KeyboardInfo): Promise<Map<number, number> | null>;
    /** 0x2C, fresh; null when the board doesn't answer it or the read failed. */
    readPointingHardware(kbinfo: KeyboardInfo): Promise<PointingHardwareReport | null>;
    /** Whether the board answers 0x2C at all. */
    hasPointingHardware(kbinfo: KeyboardInfo): boolean;
}

/** What changed: the pointing slots' new 0x18 values and, when it changed, the new 0x2C report. */
export interface PointingDetectUpdate {
    hwDetection: Map<number, number>;
    pointingHardware?: PointingHardwareReport;
}

type SlotState = "detecting" | "none" | "module";

function mapGet(m: Map<number, number> | Record<string, number> | undefined, k: number): number | undefined {
    if (!m) return undefined;
    return m instanceof Map ? m.get(k) : (m as Record<string, number>)[String(k)];
}

/** What a pointing slot shows for this 0x18 value: still detecting, no module, or a module. */
export function slotState(kbinfo: KeyboardInfo, idx: number, id: number | undefined): SlotState {
    if (id === undefined || id === NO_DETECTION) return "detecting";
    const instance = kbinfo.composition?.instances?.[idx];
    const fragments = kbinfo.fragments ?? {};
    const names = instance?.fragment ? [instance.fragment] : (instance?.fragment_options ?? []).map((o) => o.fragment);
    const name = names.find((n) => fragments[n]?.id === id);
    const module = name ? fragments[name]?.widget?.module : undefined;
    if (!module) return "detecting";
    return module === "none" ? "none" : "module";
}

const halfHasModule = (half: PointingHalfReport | undefined) =>
    !!half && half.detected !== null && half.detected !== "none";

const halfFor = (report: PointingHardwareReport | null | undefined, side: Side) =>
    report?.halves.find((h) => h.side === side);

/**
 * The pointing slots (0x18 instance indices) still waiting for a module. A
 * board without pointing slots but with 0x2C waits on its halves instead.
 */
function waiting(kbinfo: KeyboardInfo, hw: Map<number, number>, report: PointingHardwareReport | null | undefined, use2C: boolean) {
    const slots = [...widgetInstanceIndices(kbinfo)].filter((idx) => slotState(kbinfo, idx, hw.get(idx)) !== "module");
    const sides = (["left", "right"] as const).filter((side) => use2C && !halfHasModule(halfFor(report, side)));
    return { slots, sides };
}

/**
 * The new 0x2C report, keeping each half that already reported a module (a
 * hand stops changing once it has one) and each half the new read left out.
 */
function mergeReport(was: PointingHardwareReport | null | undefined, now: PointingHardwareReport | null): PointingHardwareReport | null | undefined {
    if (!now) return was;
    if (!was) return now;
    // Two halves claiming the same side: take the board's answer as it is.
    if (was.halves.length === 2 && was.halves[0].side === was.halves[1].side) return now;
    const halves = (["left", "right"] as const)
        .map((side) => {
            const before = halfFor(was, side);
            return halfHasModule(before) ? before : halfFor(now, side) ?? before;
        })
        .filter((h): h is PointingHalfReport => !!h)
        .sort((a, b) => Number(b.usb) - Number(a.usb));
    return { halves };
}

const sameHalf = (a: PointingHalfReport, b: PointingHalfReport) =>
    a.usb === b.usb && a.side === b.side && a.builtFor === b.builtFor && a.detected === b.detected &&
    a.sensorStarted === b.sensorStarted && a.auto === b.auto &&
    a.productId === b.productId && a.inverseProductId === b.inverseProductId;

const sameReport = (a: PointingHardwareReport | null | undefined, b: PointingHardwareReport | null | undefined) =>
    (!a && !b) || (!!a && !!b && a.halves.length === b.halves.length && a.halves.every((h, i) => sameHalf(h, b.halves[i])));

/** In Keybard Paranoid, the board is read only while you are looking at Keybard. */
const mayRead = () => !PARANOID || userIsLooking();

export class PointingDetectPoller {
    private timer: ReturnType<typeof setTimeout> | undefined;
    private generation = 0;
    private startedAt = 0;
    private kbinfo: KeyboardInfo | null = null;
    private hw = new Map<number, number>();
    private report: PointingHardwareReport | null | undefined;
    private onUpdate: ((update: PointingDetectUpdate) => void) | null = null;

    constructor(private deps: PointingDetectDeps, private now: () => number = () => Date.now()) {}

    /**
     * Starts watching a freshly connected board. Does nothing when every hand
     * already has a module, or the board reports neither pointing slots nor 0x2C.
     */
    start(kbinfo: KeyboardInfo, onUpdate: (update: PointingDetectUpdate) => void) {
        this.stop();
        this.kbinfo = kbinfo;
        this.onUpdate = onUpdate;
        this.hw = new Map();
        for (const idx of widgetInstanceIndices(kbinfo)) {
            const id = mapGet(kbinfo.fragmentState?.hwDetection, idx);
            if (id !== undefined) this.hw.set(idx, id);
        }
        this.report = kbinfo.pointing_hardware;
        if (!this.isWaiting()) return;
        this.startedAt = this.now();
        this.schedule();
    }

    /** Stops for good (done, disconnect, a new connection, unmount). */
    stop() {
        this.generation++;
        if (this.timer !== undefined) clearTimeout(this.timer);
        this.timer = undefined;
        this.kbinfo = null;
        this.onUpdate = null;
    }

    /** A read is scheduled. */
    get isPolling(): boolean {
        return this.timer !== undefined;
    }

    private use2C(): boolean {
        return !!this.kbinfo && widgetInstanceIndices(this.kbinfo).size === 0 && this.deps.hasPointingHardware(this.kbinfo);
    }

    private isWaiting(): boolean {
        if (!this.kbinfo) return false;
        const { slots, sides } = waiting(this.kbinfo, this.hw, this.report, this.use2C());
        return slots.length > 0 || sides.length > 0;
    }

    /** The next read in 2 s, while that is still inside the window; else stop. */
    private schedule() {
        if (this.now() - this.startedAt + POINTING_DETECT_INTERVAL_MS > POINTING_DETECT_WINDOW_MS) {
            this.stop();
            return;
        }
        const gen = this.generation;
        this.timer = setTimeout(() => {
            this.timer = undefined;
            if (gen === this.generation) void this.tick(gen);
        }, POINTING_DETECT_INTERVAL_MS);
    }

    private async tick(gen: number) {
        const kbinfo = this.kbinfo;
        if (!kbinfo) return;
        if (!mayRead()) {
            this.schedule();
            return;
        }
        const slotsWaiting = waiting(kbinfo, this.hw, this.report, false).slots;
        const want2C = this.deps.hasPointingHardware(kbinfo);
        let hw: Map<number, number> | null = null;
        let report: PointingHardwareReport | null = null;
        try {
            hw = slotsWaiting.length ? await this.deps.readHardwareDetection(kbinfo) : null;
            report = want2C ? await this.deps.readPointingHardware(kbinfo) : null;
        } catch {
            // A failed read changes nothing; the next one tries again.
        }
        if (gen !== this.generation) return;

        let changed = false;
        const nextHw = new Map(this.hw);
        if (hw) for (const idx of slotsWaiting) {
            const id = hw.get(idx);
            // Only a hand still waiting takes the new value, and only a real answer:
            // a hand that showed no module never goes back to "Detecting".
            if (id === undefined || id === NO_DETECTION || id === nextHw.get(idx)) continue;
            if (slotState(kbinfo, idx, id) === "detecting") continue;
            nextHw.set(idx, id);
            changed = true;
        }
        const nextReport = mergeReport(this.report, report);
        const reportChanged = !sameReport(this.report, nextReport);

        this.hw = nextHw;
        this.report = nextReport;
        if ((changed || reportChanged) && this.onUpdate) {
            this.onUpdate({ hwDetection: nextHw, ...(reportChanged && nextReport ? { pointingHardware: nextReport } : {}) });
        }
        if (gen !== this.generation) return;
        if (this.isWaiting()) this.schedule();
        else this.stop();
    }
}

/** Puts the poller's findings into a keyboard, leaving everything else as it was. */
export function withPointingDetection(kbinfo: KeyboardInfo, update: PointingDetectUpdate): KeyboardInfo {
    const next: KeyboardInfo = { ...kbinfo };
    if (kbinfo.fragmentState) {
        const was = kbinfo.fragmentState.hwDetection;
        const hwDetection = was instanceof Map
            ? new Map(was)
            : new Map(Object.entries(was ?? {}).map(([k, v]) => [Number(k), v as number]));
        for (const [idx, id] of update.hwDetection) hwDetection.set(idx, id);
        next.fragmentState = { ...kbinfo.fragmentState, hwDetection };
    }
    if (update.pointingHardware) next.pointing_hardware = update.pointingHardware;
    return next;
}
