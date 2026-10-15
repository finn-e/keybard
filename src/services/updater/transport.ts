// How the updater client reaches a board: one request, one reply, plus the client ID.
// webhid-transport.ts implements it over usb.service; fake-board.ts implements it in memory.

import type { UpdaterReply } from "./protocol";

/** The board refused our client ID at the wrapper (it expired, or is unknown). */
export class ClientRejectedError extends Error {
    constructor(public readonly code: number) {
        super(`The keyboard refused the client ID (wrapper error ${code})`);
        this.name = "ClientRejectedError";
    }
}

/** The device is gone: unplugged, restarting, or never opened. */
export class DisconnectedError extends Error {
    constructor(message = "The keyboard is disconnected") {
        super(message);
        this.name = "DisconnectedError";
    }
}

/** No reply within the timeout. */
export class ReplyTimeoutError extends Error {
    constructor(public readonly op: number) {
        super(`The keyboard didn't answer updater op 0x${op.toString(16)}`);
        this.name = "ReplyTimeoutError";
    }
}

export interface UpdaterTransport {
    /** One wrapped updater request with the current client ID. No retry of any kind. */
    request(op: number, hand: number, args?: ArrayLike<number>): Promise<UpdaterReply>;
    /** The client ID requests are sent with now (0 before the first bootstrap). */
    clientId(): number;
    /** Bootstrap a client ID if there's none or it's due for renewal; returns it. */
    ensureClient(): Promise<number>;
    /** Take a fresh client ID now (after a wrapper rejection); returns it. */
    renewClient(): Promise<number>;
    /** Called after every client ID change, with the new and old ID. Returns an unsubscribe. */
    onClientRenewed(listener: (id: number, old: number) => void): () => void;
    /** Called when the device goes away. Returns an unsubscribe. */
    onDisconnect(listener: () => void): () => void;
    /** Whether the device is open now. */
    connected(): boolean;
}

/** Time, injectable so the flow can run against the mock board in virtual time. */
export interface Clock {
    now(): number;
    sleep(ms: number): Promise<void>;
}

export const realClock: Clock = {
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * Virtual time: sleep() advances the clock at once and yields to other tasks.
 * Everything that waits, waits in virtual time, so a two-minute update runs in
 * milliseconds.
 */
export class VirtualClock implements Clock {
    private t: number;
    constructor(start = 1_760_000_000_000) {
        this.t = start;
    }
    now(): number {
        return this.t;
    }
    advance(ms: number): void {
        this.t += Math.max(0, ms);
    }
    async sleep(ms: number): Promise<void> {
        this.t += Math.max(0, ms);
        await Promise.resolve();
    }
}
