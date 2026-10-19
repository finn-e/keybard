// The updater transport over Keybard's open WebHID connection (usb.service).

import { ClientIdRejectedError, usbInstance, type SvilUSB } from "../usb.service";
import { decodeReply, encodeViaPayload } from "./protocol";
import { ClientRejectedError, DisconnectedError, ReplyTimeoutError, type UpdaterTransport } from "./transport";

/** Round trips measured over WebHID, for update-technical.md 1.9. */
export interface RoundTripStats {
    count: number;
    totalMs: number;
    maxMs: number;
}

export class WebHidUpdaterTransport implements UpdaterTransport {
    readonly stats: RoundTripStats = { count: 0, totalMs: 0, maxMs: 0 };

    constructor(private readonly usb: SvilUSB = usbInstance, private readonly timeoutMs = 1000) {}

    connected(): boolean {
        return this.usb.isOpen();
    }

    clientId(): number {
        return this.usb.currentClientId();
    }

    ensureClient(): Promise<number> {
        if (!this.usb.isOpen()) return Promise.reject(new DisconnectedError());
        return this.usb.ensureClient();
    }

    renewClient(): Promise<number> {
        if (!this.usb.isOpen()) return Promise.reject(new DisconnectedError());
        return this.usb.renewClient();
    }

    onClientRenewed(listener: (id: number, old: number) => void): () => void {
        return this.usb.onClientRenewed(listener);
    }

    onDisconnect(listener: () => void): () => void {
        return this.usb.addDisconnectListener(listener);
    }

    async request(op: number, hand: number, args: ArrayLike<number> = []) {
        if (!this.usb.isOpen()) throw new DisconnectedError();
        const t0 = performance.now();
        let report: Uint8Array;
        try {
            report = await this.usb.sendUpdaterReport(encodeViaPayload(op, hand, args), 3, this.timeoutMs);
        } catch (error) {
            if (error instanceof ClientIdRejectedError) throw new ClientRejectedError(error.code);
            if (!this.usb.isOpen()) throw new DisconnectedError();
            if (error instanceof Error && /timeout/i.test(error.message)) throw new ReplyTimeoutError(op);
            if (error instanceof Error && /not connected|closed|NotFoundError|InvalidStateError/i.test(`${error.name} ${error.message}`)) throw new DisconnectedError(error.message);
            throw error;
        }
        const ms = performance.now() - t0;
        this.stats.count += 1;
        this.stats.totalMs += ms;
        this.stats.maxMs = Math.max(this.stats.maxMs, ms);
        return decodeReply(report);
    }
}
