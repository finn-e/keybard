import type { KeyboardInfo } from "../types/keyboard.types";
import { keyService } from "./key.service";
import { SVIL_MACRO_BUFFER_HEADER_BYTES, SvilUSB, checkSvilStatus, svilHasMacroBuffer } from "./usb.service";
import { payloadCapacity } from "./hid-report";

export class MacroService {
    private readonly MACRO_IDS = {
        1: "tap",
        tap: 1,
        2: "down",
        down: 2,
        3: "up",
        up: 3,
    } as const;

    private readonly MACRO_DELAY = 4;

    private readonly MACRO_DOUBLES = {
        5: "tap",
        tap: 5,
        6: "down",
        down: 6,
        7: "up",
        up: 7,
    } as const;

    private readonly QMK_EXT_ID = 1;

    // MACRO_BUFFER_GET/SET data room: the report minus the wrapper and
    // [cmd][offset:4][count], i.e. 20 bytes at 32, 52 at 64. The firmware refuses
    // a count larger than that.
    private get svilMacroChunk(): number {
        return payloadCapacity(this.usb, SVIL_MACRO_BUFFER_HEADER_BYTES);
    }

    constructor(private usb: SvilUSB) { }

    async get(kbinfo: KeyboardInfo): Promise<void> {
        function checkComplete(data: any) {
            return data.filter((x: any) => x === 0).length >= kbinfo.macro_count!;
        }
        // Macros are stored as one big chunk of memory, null-separated.
        // v3+ firmware: read through Sval with 32-bit offsets (the buffer is past 64 KB);
        // older firmware: VIA buffer reads.
        const macro_memory = svilHasMacroBuffer(this.usb.svilProtocolVersion)
            ? await this.getSvilBuffer(kbinfo.macros_size || 0, kbinfo.macro_count || 0)
            : await this.usb.getViaBuffer(SvilUSB.CMD_VIA_MACRO_GET_BUFFER, kbinfo.macros_size || 0, { slice: 4, uint8: true, bytes: 1 }, checkComplete);

        const raw_macros = this.split(kbinfo, macro_memory);
        kbinfo.macros = raw_macros.map((macro, mid) => this.parse(mid, macro));
    }

    async push(kbinfo: KeyboardInfo): Promise<void> {
        if (!kbinfo.macros) return;
        const raw = this.dump(kbinfo.macros_size!, kbinfo.macros);
        const rawview = new Uint8Array(raw);
        let i;
        let count = 0;
        for (i = 0; i < kbinfo.macros_size! && count <= kbinfo.macro_count!; i++) {
            if (rawview[i] === 0) {
                count++;
            }
        }
        const size = i;
        if (svilHasMacroBuffer(this.usb.svilProtocolVersion)) {
            await this.pushSvilBuffer(size, rawview);
        } else {
            await this.usb.pushViaBuffer(SvilUSB.CMD_VIA_MACRO_SET_BUFFER, size, raw);
        }
    }

    /**
     * Read the macro buffer through Sval MACRO_BUFFER_GET (v3+), stopping once all
     * macroCount terminators are in, so a mostly empty 100 KB buffer is not read whole.
     * Request:  [offset:4][count]
     * Response: [cmd_echo][offset:4][count][data...]
     */
    private async getSvilBuffer(size: number, macroCount: number): Promise<number[]> {
        const alldata: number[] = [];
        let offset = 0;
        let terminators = 0;

        while (offset < size) {
            const count = Math.min(this.svilMacroChunk, size - offset);
            const data = await this.usb.sendSvil(
                SvilUSB.CMD_SVIL_MACRO_BUFFER_GET,
                [...this.LE32(offset), count],
                { uint8: true }
            ) as Uint8Array;

            // An out-of-range request is answered with status 1 in place of the offset echo
            const echoed = (data[1] | (data[2] << 8) | (data[3] << 16) | (data[4] << 24)) >>> 0;
            if (echoed !== offset || data[5] !== count) {
                throw new Error(`Macro buffer read at ${offset} refused (status ${data[1]})`);
            }
            for (const b of data.slice(6, 6 + count)) {
                alldata.push(b);
                if (b === 0) terminators++;
            }
            offset += count;

            if (terminators >= macroCount) break;
        }
        return alldata;
    }

    /**
     * Write the first size bytes of the macro buffer through Sval MACRO_BUFFER_SET (v3+).
     * Request:  [offset:4][count][data...]
     * Response: [cmd_echo][status], 0 = ok, 1 = out of range
     */
    private async pushSvilBuffer(size: number, buffer: Uint8Array): Promise<void> {
        const chunk = this.svilMacroChunk;
        for (let offset = 0; offset < size; offset += chunk) {
            const count = Math.min(chunk, size - offset);
            const resp = await this.usb.sendSvil(
                SvilUSB.CMD_SVIL_MACRO_BUFFER_SET,
                [...this.LE32(offset), count, ...buffer.slice(offset, offset + count)],
                { uint8: true }
            ) as Uint8Array;
            checkSvilStatus(SvilUSB.CMD_SVIL_MACRO_BUFFER_SET, resp);
        }
    }

    private LE32(val: number): [number, number, number, number] {
        return [val & 0xFF, (val >> 8) & 0xFF, (val >> 16) & 0xFF, (val >>> 24) & 0xFF];
    }

    split(kbinfo: KeyboardInfo, rawbuffer: number[] | Uint8Array): (number[] | Uint8Array)[] {
        let offset = 0;
        const macros: (number[] | Uint8Array)[] = [];
        let macronum = 0;
        while (macronum < kbinfo.macro_count! && offset < rawbuffer.length) {
            const start = offset;
            // Bounded: a buffer read to its end may lack the last terminators
            while (offset < rawbuffer.length && rawbuffer[offset] != 0) offset++;
            macros.push(rawbuffer.slice(start, offset));
            macronum++;
            offset++;
        }
        return macros;
    }

    parse(mid: number, rawmacro: number[] | Uint8Array): any {
        const actions: any[] = [];
        let offset = 0;
        let curoffset = 0;

        while (offset < rawmacro.length) {
            if (rawmacro[offset] === this.QMK_EXT_ID) {
                if (offset + 1 >= rawmacro.length) break;
                const type = rawmacro[offset + 1];

                if (type in this.MACRO_IDS) {
                    if (offset + 2 >= rawmacro.length) break;
                    actions.push([this.MACRO_IDS[type as keyof typeof this.MACRO_IDS], keyService.stringify(rawmacro[offset + 2])]);
                    offset += 3;
                } else if (type === this.MACRO_DELAY) {
                    if (offset + 3 >= rawmacro.length) break;
                    actions.push(["delay", rawmacro[offset + 2] - 1 + (rawmacro[offset + 3] - 1) * 255]);
                    offset += 4;
                } else if (type in this.MACRO_DOUBLES) {
                    if (offset + 3 >= rawmacro.length) break;
                    actions.push([this.MACRO_DOUBLES[type as keyof typeof this.MACRO_DOUBLES], keyService.stringify(rawmacro[offset + 2] + (rawmacro[offset + 3] << 8))]);
                    offset += 4;
                }
            } else if (rawmacro[offset] === 0) {
                return {
                    mid: mid,
                    actions: actions,
                };
            } else {
                const start = offset;
                while (offset < rawmacro.length && rawmacro[offset] > 4) offset++;
                const newbuffer = new Uint8Array(rawmacro.slice(start, offset));
                const dv = new DataView(newbuffer.buffer);
                const decoder = new TextDecoder();
                actions.push(["text", decoder.decode(dv)]);
            }
            if (curoffset === offset) {
                break;
            }
            curoffset = offset;
        }
        return {
            mid: mid,
            actions: actions,
        };
    }

    dump(size: number, macros: any[]): ArrayBuffer {
        const buffer = new ArrayBuffer(size);
        const dv = new DataView(buffer);
        let offset = 0;

        for (let mid = 0; mid < macros.length; mid++) {
            const macro = macros[mid];
            for (const action of macro.actions) {
                if (action[0] === "text") {
                    const encoder = new TextEncoder();
                    const textbuffer = new Uint8Array(encoder.encode(action[1]));
                    for (let idx = 0; idx < textbuffer.length; idx++) {
                        dv.setUint8(offset++, textbuffer[idx]);
                    }
                } else if (action[0] === "delay") {
                    dv.setUint8(offset++, this.QMK_EXT_ID);
                    dv.setUint8(offset++, this.MACRO_DELAY);
                    dv.setUint8(offset++, (action[1] % 255) + 1);
                    dv.setUint8(offset++, Math.floor(action[1] / 255) + 1);
                } else if (action[0] in this.MACRO_IDS) {
                    const value = keyService.parse(action[1]);
                    // Skip KC_NO (0) to prevent early termination of the macro string
                    if (value === 0) continue;

                    dv.setUint8(offset++, this.QMK_EXT_ID);
                    if (value >= 0x100) {
                        dv.setUint8(offset++, this.MACRO_DOUBLES[action[0] as keyof typeof this.MACRO_DOUBLES] as number);
                        dv.setUint8(offset++, value & 0xff);
                        dv.setUint8(offset++, (value >> 8) & 0xff);
                    } else {
                        dv.setUint8(offset++, this.MACRO_IDS[action[0] as keyof typeof this.MACRO_IDS] as number);
                        dv.setUint8(offset++, value);
                    }
                }
            }
            dv.setUint8(offset++, 0);
        }
        return buffer;
    }
}
