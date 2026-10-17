// Late pointing-module detection. The board retries its pointing probe after
// power-on (1.5, 3, 6, 12 and 30 s, then never again), so a module can show up
// after Keybard has read the board at connect. This is the one reader that
// keeps asking: it re-reads hardware detection (0x18) about every 2 s while a
// pointing slot still shows "Detecting" or no module, for up to 35 s after
// connect, then stops for good. It stops for a hand once that
// hand reports a module, and stops altogether once every hand has one. It only
// reads; it never writes.
//
// What it finds goes back into fragmentState.hwDetection through the caller's
// apply, which keeps it out of the unsaved edits: it's board state, not part of
// the layout. A module found this way just starts working: the Hardware rows,
// the composition and the drawn devices follow it, and nothing announces it.
// It never touches pointing_hardware (0x2C), so the firmware mismatch dialog
// keeps deciding from the report read at connect and a late find can't open it.
//
// On firmware that never retries, the answers just never change: at most 17
// reads of 0x18, then nothing.

import { PARANOID, userIsLooking } from "@/lib/paranoid";
import { widgetInstanceIndices } from "@/services/fragment-composer.service";
import type { KeyboardInfo } from "@/types/keyboard.types";

export const POINTING_DETECT_INTERVAL_MS = 2000;
/** The board's last probe is 30 s after power-on; connect comes after power-on, so this covers it. */
export const POINTING_DETECT_WINDOW_MS = 35000;

const NO_DETECTION = 0xff;

/** What the poller reads from the board; injectable for tests. */
export interface PointingDetectDeps {
    /** 0x18, fresh; null when the board has no fragments or the read failed. */
    readHardwareDetection(kbinfo: KeyboardInfo): Promise<Map<number, number> | null>;
}

/** What changed: the pointing slots' new 0x18 values. */
export interface PointingDetectUpdate {
    hwDetection: Map<number, number>;
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

/** The pointing slots (0x18 instance indices) still waiting for a module. */
function waitingSlots(kbinfo: KeyboardInfo, hw: Map<number, number>): number[] {
    return [...widgetInstanceIndices(kbinfo)].filter((idx) => slotState(kbinfo, idx, hw.get(idx)) !== "module");
}

/** In Keybard Paranoid, the board is read only while you are looking at Keybard. */
const mayRead = () => !PARANOID || userIsLooking();

export class PointingDetectPoller {
    private timer: ReturnType<typeof setTimeout> | undefined;
    private generation = 0;
    private startedAt = 0;
    private kbinfo: KeyboardInfo | null = null;
    private hw = new Map<number, number>();
    private onUpdate: ((update: PointingDetectUpdate) => void) | null = null;

    constructor(private deps: PointingDetectDeps, private now: () => number = () => Date.now()) {}

    /**
     * Starts watching a freshly connected board. Does nothing when every hand
     * already has a module, or the board has no pointing slots.
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

    private isWaiting(): boolean {
        return !!this.kbinfo && waitingSlots(this.kbinfo, this.hw).length > 0;
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
        const slotsWaiting = waitingSlots(kbinfo, this.hw);
        let hw: Map<number, number> | null = null;
        try {
            hw = await this.deps.readHardwareDetection(kbinfo);
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
        this.hw = nextHw;
        if (changed && this.onUpdate) this.onUpdate({ hwDetection: nextHw });
        if (gen !== this.generation) return;
        if (this.isWaiting()) this.schedule();
        else this.stop();
    }
}

/** Puts the poller's findings into a keyboard, leaving everything else (pointing_hardware included) as it was. */
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
    return next;
}
