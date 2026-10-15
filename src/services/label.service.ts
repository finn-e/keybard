import type { KeyboardInfo } from "@/types/keyboard.types";
import { SvilUSB, svilHasWideIndex, svilIndexArgs } from "./usb.service";

export type LabelKind = "layer" | "macro" | "tapdance";
const labelTypes = {
    layer: SvilUSB.SVIL_LABEL_TYPE_LAYER,
    macro: SvilUSB.SVIL_LABEL_TYPE_MACRO,
    tapdance: SvilUSB.SVIL_LABEL_TYPE_TAP_DANCE,
};

/**
 * The rules every stored name follows: up to 16 UTF-8 bytes, no control
 * characters. Combo names, which Keybard keeps only in files and backups,
 * follow them too, so they can move to the board unchanged later.
 */
export function validateLabelText(name: string): void {
    if (new TextEncoder().encode(name).length > SvilUSB.SVIL_LABEL_SIZE) {
        throw new Error("Names can use up to 16 UTF-8 bytes; accented letters and emoji use more than one byte.");
    }
    if (/[\u0000-\u001f\u007f]/.test(name)) throw new Error("Names cannot contain control characters.");
}

/**
 * Labels stored on the keyboard (CMD_SVIL_LABEL_*): a fixed 16-byte, null-padded
 * UTF-8 name per layer, tap dance or macro (SvilUSB.SVIL_LABEL_TYPE_*).
 */
export class LabelService {
    constructor(private usb: SvilUSB) { }

    async loadLayerNames(kb: KeyboardInfo): Promise<void> {
        if ((kb.svil_proto ?? 1) < 2) return;
        const labels = await this.getAll(SvilUSB.SVIL_LABEL_TYPE_LAYER, kb.layers ?? 0);
        kb.cosmetic ??= {};
        // The board is authoritative: labels omitted by its sparse scan are blank.
        // Replace the entire map so cleared names cannot inherit old/default labels.
        kb.cosmetic.layer = {};
        for (const [index, name] of labels) {
            if (index < (kb.layers ?? 0)) kb.cosmetic.layer[index.toString()] = name;
        }
    }

    async loadBindingNames(kb: KeyboardInfo): Promise<void> {
        if ((kb.svil_proto ?? 1) < 2) return;
        kb.cosmetic ??= {};
        for (const kind of ["macro", "tapdance"] as const) {
            const count = kind === "macro" ? kb.macro_count ?? kb.macros?.length ?? 0
                : kb.tapdance_count ?? kb.tapdances?.length ?? 0;
            const names = count > 0 ? await this.getAll(labelTypes[kind], count) : new Map<number, string>();
            const key = kind === "macro" ? "macros" : "tapdances";
            kb.cosmetic[key] = {};
            for (const [index, name] of names) {
                if (index < count) kb.cosmetic[key]![String(index)] = name;
            }
        }
    }

    validateName(kb: KeyboardInfo, kind: LabelKind, name: string): void {
        if ((kb.svil_proto ?? 1) < 2) throw new Error(`This firmware cannot save ${kind} names on the keyboard. Names in offline layouts are included in exported backups.`);
        validateLabelText(name);
    }

    async saveName(kb: KeyboardInfo, kind: LabelKind, index: number, name: string): Promise<void> {
        this.validateName(kb, kind, name);
        const ok = name ? await this.set(labelTypes[kind], index, name) : await this.clear(labelTypes[kind], index);
        if (!ok) throw new Error(`The keyboard refused to save the ${kind} name.`);
    }

    validateLayerName(kb: KeyboardInfo, name: string): void {
        if ((kb.svil_proto ?? 1) < 2) throw new Error("This firmware cannot save layer names on the keyboard.");
        if (new TextEncoder().encode(name).length > SvilUSB.SVIL_LABEL_SIZE) {
            throw new Error("Layer names can use up to 16 UTF-8 bytes; accented letters and emoji use more than one byte.");
        }
        if (/[\u0000-\u0008\u000a-\u001f\u007f]/.test(name)) throw new Error("Layer names cannot contain control characters.");
    }

    async saveLayerName(kb: KeyboardInfo, index: number, name: string): Promise<void> {
        this.validateLayerName(kb, name);
        const ok = name ? await this.set(SvilUSB.SVIL_LABEL_TYPE_LAYER, index, name)
            : await this.clear(SvilUSB.SVIL_LABEL_TYPE_LAYER, index);
        if (!ok) throw new Error("The keyboard refused to save the layer name.");
    }

    /**
     * Read every non-empty label of a type, keyed by index.
     * count is the size of that table; v1 needs it to size the presence bitmap.
     */
    async getAll(type: number, count: number): Promise<Map<number, string>> {
        if (svilHasWideIndex(this.usb.svilProtocolVersion)) {
            return this.scan(type);
        }
        return this.getBulkV1(type, count);
    }

    /**
     * v2: LABEL_GET returns the next non-empty label at or after a start index.
     * Request:  [type][start lo][start hi]
     * Response: [cmd_echo][type][found][index lo][index hi][label:16]
     * Ask again from index + 1 until found = 0.
     */
    private async scan(type: number): Promise<Map<number, string>> {
        const labels = new Map<number, string>();
        let start = 0;
        while (start <= 0xffff) {
            const data = await this.usb.sendSvil(
                SvilUSB.CMD_SVIL_LABEL_GET,
                [type, start & 0xff, (start >> 8) & 0xff],
                { uint8: true }
            ) as Uint8Array;

            if (!data[2]) break; // found = 0: no labels left
            const index = data[3] | (data[4] << 8);
            if (index < start) break; // Never loop on a keyboard that answers backwards
            labels.set(index, this.decode(data.slice(5, 5 + SvilUSB.SVIL_LABEL_SIZE)));
            start = index + 1;
        }
        return labels;
    }

    /**
     * v1: LABEL_GET returns a presence bitmap (first request only) and as many
     * labels as fit, with a continuation flag.
     * Request:  [type][offset]
     * Response: [cmd_echo][type][flags][bitmap:ceil(count/8), offset 0 only][label:16]...
     * flags bit 0 = more labels; bitmap is MSB first. Continue after the last label read.
     */
    private async getBulkV1(type: number, count: number): Promise<Map<number, string>> {
        const labels = new Map<number, string>();
        const bitmapSize = Math.ceil(count / 8);
        let present: number[] = [];
        let offset = 0;

        while (offset < count) {
            const data = await this.usb.sendSvil(
                SvilUSB.CMD_SVIL_LABEL_GET,
                [type, offset],
                { uint8: true }
            ) as Uint8Array;

            let pos = 3;
            if (offset === 0) {
                present = [];
                for (let i = 0; i < count; i++) {
                    if (data[pos + (i >> 3)] & (0x80 >> (i & 7))) present.push(i);
                }
                pos += bitmapSize;
            }

            let last = -1;
            for (const index of present) {
                if (index < offset) continue;
                if (pos + SvilUSB.SVIL_LABEL_SIZE > data.length) break;
                labels.set(index, this.decode(data.slice(pos, pos + SvilUSB.SVIL_LABEL_SIZE)));
                pos += SvilUSB.SVIL_LABEL_SIZE;
                last = index;
            }

            if (!(data[2] & 0x01) || last < 0) break;
            offset = last + 1;
        }
        return labels;
    }

    /**
     * Store a label. Returns false if the keyboard refused it (bad type, index
     * out of range or invalid UTF-8).
     * Request: [type][index (v1: 1 byte, v2: 2 bytes)][label:16]; Response: [cmd_echo][status]
     */
    async set(type: number, index: number, label: string): Promise<boolean> {
        const data = await this.usb.sendSvil(
            SvilUSB.CMD_SVIL_LABEL_SET,
            [type, ...svilIndexArgs(this.usb.svilProtocolVersion, index), ...this.encode(label)],
            { uint8: true }
        ) as Uint8Array;
        return data[1] === 0;
    }

    /**
     * Clear a label. Request: [type][index (v1: 1 byte, v2: 2 bytes)]; Response: [cmd_echo][status]
     */
    async clear(type: number, index: number): Promise<boolean> {
        const data = await this.usb.sendSvil(
            SvilUSB.CMD_SVIL_LABEL_CLEAR,
            [type, ...svilIndexArgs(this.usb.svilProtocolVersion, index)],
            { uint8: true }
        ) as Uint8Array;
        return data[1] === 0;
    }

    /** UTF-8 encode into the fixed label field, never splitting a character. */
    encode(label: string): number[] {
        const out: number[] = [];
        const encoder = new TextEncoder();
        for (const ch of label) {
            const bytes = encoder.encode(ch);
            if (out.length + bytes.length > SvilUSB.SVIL_LABEL_SIZE) break;
            out.push(...bytes);
        }
        while (out.length < SvilUSB.SVIL_LABEL_SIZE) out.push(0);
        return out;
    }

    decode(bytes: Uint8Array): string {
        const end = bytes.indexOf(0);
        return new TextDecoder().decode(end < 0 ? bytes : bytes.slice(0, end));
    }
}
