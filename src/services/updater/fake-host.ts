// The flow's host over FakeSvalboard: the mock board's restarts, its storage flags,
// and a stand-in for putting the layout back. Used by the tests and the harness.

import { FakeSvalboard, type Fault, type FakeHalfConfig } from "./fake-board";
import type { FlowHost } from "./flow";
import { HAND_LEFT, HAND_RIGHT, type Hand } from "./protocol";
import { buildSvup, loadSvup, type SvupFile } from "./svup";
import type { Clock, UpdaterTransport } from "./transport";

export interface FakeHostOptions {
    restoreFails?: boolean;
    trimmed?: string[];
}

export class FakeHost implements FlowHost {
    restores = 0;
    clears = 0;
    /** Order of the Sval-side calls, for "0x2A last". */
    readonly events: string[] = [];

    constructor(readonly board: FakeSvalboard, readonly clock: Clock, private o: FakeHostOptions = {}) {}

    transport(): UpdaterTransport | null {
        return this.board.connected() ? this.board : null;
    }

    async waitForDevice(timeoutMs: number): Promise<UpdaterTransport | null> {
        const deadline = this.clock.now() + timeoutMs;
        while (this.clock.now() < deadline) {
            if (this.board.connected()) {
                this.events.push("reconnected");
                return this.board;
            }
            await this.clock.sleep(250);
        }
        return null;
    }

    async readStorageFlags(): Promise<number> {
        this.events.push(`flags:${this.board.storageFlags}`);
        return this.board.storageFlags;
    }

    async clearStorageReset(): Promise<void> {
        this.clears++;
        this.events.push("0x2A");
        this.board.clearStorageReset();
    }

    async keymapBlank(): Promise<boolean> {
        this.events.push("keymap");
        return this.board.settings[this.board.usbHand] === "blank";
    }

    async restoreLayout(_svil: string): Promise<{ trimmed: string[] }> {
        this.restores++;
        this.events.push("restore");
        if (this.o.restoreFails) throw new Error("The keyboard stopped answering while the layout was written.");
        this.board.restoreSettings();
        return { trimmed: this.o.trimmed ?? [] };
    }
}

export interface FixtureRelease {
    tag: string;
    fwVersion: number;
    files: Record<Hand, SvupFile>;
}

/** A pair of synthetic .svup files for one release. */
export async function fixtureRelease(tag: string, fwVersion: number, o: { noChord?: boolean; imageLen?: number; flags?: number } = {}): Promise<FixtureRelease> {
    const make = async (hand: Hand) => loadSvup(await buildSvup({
        hand, fwVersion, tag, imageLen: o.imageLen ?? 0x2000, buildFlags: o.noChord ? 0x40 : 0, flags: o.flags,
    }));
    return { tag, fwVersion, files: { [HAND_LEFT]: await make(HAND_LEFT), [HAND_RIGHT]: await make(HAND_RIGHT) } as Record<Hand, SvupFile> };
}

export interface FakeSetupOptions {
    clock: Clock;
    /** What both halves run now. */
    running: FixtureRelease | { tag: string; fwVersion: number };
    usbHand?: Hand;
    noChord?: boolean;
    release?: boolean;
    chordAfterMs?: number | "never";
    faults?: Fault[];
    otherRunning?: { tag: string; fwVersion: number };
    host?: FakeHostOptions;
    half?: Partial<FakeHalfConfig>;
}

/** A mock board running `running` on both halves, and its host. */
export function fakeSetup(o: FakeSetupOptions): { board: FakeSvalboard; host: FakeHost } {
    const imageId = (hand: Hand, r: FakeSetupOptions["running"]) =>
        "files" in r ? Array.from(r.files[hand].manifestBytes.subarray(44, 60), (b) => b.toString(16).padStart(2, "0")).join("") : `${r.tag}-${r.fwVersion}-${hand}`;
    const usbHand = o.usbHand ?? HAND_RIGHT;
    const cfg = (hand: Hand): FakeHalfConfig => {
        const r = hand !== usbHand && o.otherRunning ? o.otherRunning : o.running;
        return { fwVersion: r.fwVersion, tag: r.tag, imageId: imageId(hand, r), noChord: o.noChord, release: o.release, ...o.half };
    };
    const board = new FakeSvalboard({
        usbHand, clock: o.clock, left: cfg(HAND_LEFT), right: cfg(HAND_RIGHT), chordAfterMs: o.chordAfterMs, faults: o.faults,
    });
    return { board, host: new FakeHost(board, o.clock, o.host) };
}
