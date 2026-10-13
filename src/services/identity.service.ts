// Board identity: the persistent USB serial and the user-chosen board name.
// Wire format: sval-qmk keyboards/svalboard/identity.c (VIA custom values, channel 0x49).
import { SvilUSB, usbInstance } from "./usb.service";
import { WRAPPER_HEADER_BYTES, payloadCapacity } from "./hid-report";

export const IDENTITY_CHANNEL = 0x49;
export const NAME_MAX_CHARS = 32;

const OP_INFO = 0;
const OP_NAME = 1;
const OP_COMMIT = 2;
const OP_REBOOT = 3;
// A name chunk is the report minus 6 wrapper bytes and 5 identity header bytes
// ([cmd][channel][op][offset][length]): 21 bytes at 32, 53 at 64. The firmware
// derives its limit from the report length the same way.
const NAME_HEADER_BYTES = WRAPPER_HEADER_BYTES + 5;

export enum IdentityStatus {
    Ok = 0,
    Invalid = 1,
    Unavailable = 2,
    WriteFailed = 3,
}

export enum SerialSource {
    None = 0,
    FlashId = 1,
    Random = 2,
}

export interface IdentityInfo {
    /** The firmware keeps an identity (the flash has room for it). */
    available: boolean;
    name: string;
    nameMaxBytes: number;
    serialSource: SerialSource;
    /** As the USB serial shows it, e.g. "sval:E46498769F365934". */
    serial: string;
}

/** Characters as people count them (code points), not UTF-16 units. */
export function nameLength(name: string): number {
    return Array.from(name).length;
}

/** Why a name cannot be saved, or null when it can. */
export function nameProblem(name: string, maxBytes: number): string | null {
    if (nameLength(name) > NAME_MAX_CHARS) return `Use at most ${NAME_MAX_CHARS} characters.`;
    if (new TextEncoder().encode(name).length > maxBytes) return "That name is too long for the keyboard.";
    if (/[\u0000-\u0008\u000a-\u001f\u007f]/.test(name)) return "Names can't contain control characters.";
    return null;
}

export class IdentityService {
    private usb: SvilUSB;

    constructor(usb: SvilUSB) {
        this.usb = usb;
    }

    private async request(cmd: number, op: number, args: number[] = []): Promise<Uint8Array> {
        const resp = await this.usb.send(cmd, [IDENTITY_CHANNEL, op, ...args], {
            uint8: true,
            skipBytes: 3, // cmd echo, channel, op
            validateInput: (u: Uint8Array) => u[0] === cmd && u[1] === IDENTITY_CHANNEL && u[2] === op,
        });
        return resp as Uint8Array;
    }

    /**
     * Read the identity, or null when the firmware does not speak this protocol.
     * Firmware without it ignores the channel and answers some other value, so
     * require the protocol version and the name limit to both look right.
     */
    async getInfo(): Promise<IdentityInfo | null> {
        let v: Uint8Array;
        try {
            v = await this.request(SvilUSB.CMD_VIA_LIGHTING_GET_VALUE, OP_INFO);
        } catch {
            return null;
        }
        const proto = v[0];
        const nameMaxBytes = v[3];
        if (proto !== 1 || nameMaxBytes < NAME_MAX_CHARS || nameMaxBytes > 255) return null;
        const nameLen = v[2];
        const serialHex = Array.from(v.slice(5, 13), (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
        return {
            available: v[1] === 1,
            name: nameLen ? await this.readName(nameLen) : "",
            nameMaxBytes,
            serialSource: v[4] as SerialSource,
            serial: `sval:${serialHex}`,
        };
    }

    private async readName(length: number): Promise<string> {
        const bytes: number[] = [];
        while (bytes.length < length) {
            const v = await this.request(SvilUSB.CMD_VIA_LIGHTING_GET_VALUE, OP_NAME, [bytes.length]);
            const n = v[1];
            if (n === 0) break;
            bytes.push(...v.slice(2, 2 + n));
        }
        return new TextDecoder().decode(new Uint8Array(bytes));
    }

    /** Store a new name (empty clears it). It reaches the OS on the next restart. */
    async setName(name: string): Promise<IdentityStatus> {
        const bytes = new TextEncoder().encode(name);
        const chunkSize = payloadCapacity(this.usb, NAME_HEADER_BYTES);
        for (let off = 0; off < bytes.length; off += chunkSize) {
            const chunk = Array.from(bytes.slice(off, off + chunkSize));
            const v = await this.request(SvilUSB.CMD_VIA_LIGHTING_SET_VALUE, OP_NAME, [off, chunk.length, ...chunk]);
            if (v[0] !== IdentityStatus.Ok) return v[0] as IdentityStatus;
        }
        const v = await this.request(SvilUSB.CMD_VIA_LIGHTING_SET_VALUE, OP_COMMIT, [bytes.length]);
        return v[0] as IdentityStatus;
    }

    /** Restart the keyboard (not into the bootloader) so the OS picks up the new name. Expect a disconnect. */
    async restart(): Promise<void> {
        await this.request(SvilUSB.CMD_VIA_LIGHTING_SET_VALUE, OP_REBOOT);
    }
}

export const identityService = new IdentityService(usbInstance);
