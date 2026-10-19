import type { KeyboardInfo } from "../types/keyboard.types";
import { keyService } from "./key.service";
import { MAX_TAPDANCE_TERM_MS } from "../utils/tapdance-term";
import { SVIL_TABLE_TAP_DANCE, SvilUSB, checkSvilStatus, readSvilTable, svilIndexArgs } from "./usb.service";

export class TapdanceService {
    constructor(private usb: SvilUSB) { }

    async get(kbinfo: KeyboardInfo): Promise<void> {
        const tapdance_count = kbinfo.tapdance_count || 0;
        if (tapdance_count === 0) return;

        kbinfo.tapdances = [];

        // Use Svil protocol: scan (v3+) or per-index get
        const entries = await readSvilTable(this.usb, SVIL_TABLE_TAP_DANCE, tapdance_count);
        for (let i = 0; i < tapdance_count; i++) {
            const data = entries[i];

            // Entry: [tap:2][hold:2][doubletap:2][taphold:2][tapping_term:2]
            // tapping_term is 2 bytes: bit 15 = enabled flag, bits 0-14 = timing in ms
            const dv = new DataView(data.buffer);
            const termRaw = dv.getUint16(8, true);
            kbinfo.tapdances.push({
                idx: i,
                tap: keyService.stringify(dv.getUint16(0, true)),
                hold: keyService.stringify(dv.getUint16(2, true)),
                doubletap: keyService.stringify(dv.getUint16(4, true)),
                taphold: keyService.stringify(dv.getUint16(6, true)),
                tapping_term: termRaw & 0x7FFF,
                enabled: (termRaw & 0x8000) !== 0,
            });
        }
    }

    async push(kbinfo: KeyboardInfo, tdid?: number): Promise<void> {
        if (!kbinfo.tapdances) return;

        const toPush = tdid !== undefined
            ? kbinfo.tapdances.filter(td => td.idx === tdid)
            : kbinfo.tapdances;

        for (const td of toPush) {
            // Use Svil protocol: direct tap dance set command
            // tapping_term is 2 bytes: bit 15 = enabled flag, bits 0-14 = timing in ms
            const requestedTerm = td.tapping_term ?? 200;
            if (!Number.isFinite(requestedTerm)) throw new Error("Tap dance timing must be a finite number.");
            const term = Math.max(0, Math.min(MAX_TAPDANCE_TERM_MS, Math.round(requestedTerm)));
            // Tap dances are always on: every write sets the enabled bit.
            const termWithEnabled = term | 0x8000;
            const resp = await this.usb.sendSvil(SvilUSB.CMD_SVIL_TAP_DANCE_SET, [
                ...svilIndexArgs(this.usb.svilProtocolVersion, td.idx),
                ...this.LE16(keyService.parse(td.tap)),
                ...this.LE16(keyService.parse(td.hold)),
                ...this.LE16(keyService.parse(td.doubletap)),
                ...this.LE16(keyService.parse(td.taphold)),
                ...this.LE16(termWithEnabled),
            ], { uint8: true }) as Uint8Array;
            // Response: [cmd_echo][status], nonzero = refused (e.g. index out of range)
            checkSvilStatus(SvilUSB.CMD_SVIL_TAP_DANCE_SET, resp);
        }
    }

    private LE16(val: number): [number, number] {
        return [val & 0xFF, (val >> 8) & 0xFF];
    }
}
