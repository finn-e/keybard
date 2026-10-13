import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SvilUSB, CLIENT_ERR_INVALID_ID } from '../../src/services/usb.service';
import { LinuxHidAccessError } from '../../src/utils/linux-hid-access';

const WRAPPER = 0xdd;
const VIA = 0xfe;

/**
 * A fake HID device that behaves like the firmware's client wrapper:
 * bootstrap requests get a fresh ID; wrapped commands are answered by a
 * scripted responder so a test can inject error frames.
 */
function makeDevice(respond: (clientId: number, payload: Uint8Array, reply: (frame: Uint8Array) => void) => void) {
    const listeners = new Set<(ev: { data: DataView }) => void>();
    let nextId = 0x0005031d;
    const issued: number[] = [];
    const sent: Uint8Array[] = [];
    const deliver = (frame: Uint8Array) => {
        const buf = new Uint8Array(32); buf.set(frame.slice(0, 32));
        const ev = { data: new DataView(buf.buffer) };
        for (const l of Array.from(listeners)) l(ev);
    };
    const device = {
        productName: 'Svalboard ScanLab', vendorId: 0x303a, productId: 0x4044, opened: false,
        collections: [{ usagePage: 0xff61, usage: 0x62, inputReports: [], outputReports: [], featureReports: [] }],
        open: vi.fn(async () => { device.opened = true; }),
        close: vi.fn(async () => { device.opened = false; }),
        addEventListener: vi.fn((_t: string, l: (ev: { data: DataView }) => void) => { listeners.add(l); }),
        removeEventListener: vi.fn((_t: string, l: (ev: { data: DataView }) => void) => { listeners.delete(l); }),
        sendReport: vi.fn(async (_id: number, data: BufferSource) => {
            const msg = new Uint8Array(data as ArrayBuffer);
            sent.push(msg.slice());
            const clientId = msg[1] | (msg[2] << 8) | (msg[3] << 16) | (msg[4] << 24);
            setTimeout(() => {
                if (clientId === 0) {
                    const id = nextId++;
                    issued.push(id);
                    const f = new Uint8Array(32); f[0] = WRAPPER; f.set(msg.slice(5, 25), 5);
                    f[25] = id & 0xff; f[26] = (id >> 8) & 0xff; f[27] = (id >> 16) & 0xff; f[28] = (id >> 24) & 0xff;
                    f[29] = 120; f[30] = 0;
                    deliver(f);
                } else {
                    respond(clientId, msg.slice(6), deliver);
                }
            }, 0);
        }),
    };
    return { device, issued, sent };
}

const errorFrame = (clientId: number, code: number) => {
    const f = new Uint8Array(32); f[0] = WRAPPER;
    f[1] = clientId & 0xff; f[2] = (clientId >> 8) & 0xff; f[3] = (clientId >> 16) & 0xff; f[4] = (clientId >> 24) & 0xff;
    f[5] = 0xff; f[6] = code; return f;
};
const viaFrame = (clientId: number, payload: number[]) => {
    const f = new Uint8Array(32); f[0] = WRAPPER;
    f[1] = clientId & 0xff; f[2] = (clientId >> 8) & 0xff; f[3] = (clientId >> 16) & 0xff; f[4] = (clientId >> 24) & 0xff;
    f[5] = VIA; f.set(payload, 6); return f;
};

describe('SvilUSB client-ID lease', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('re-bootstraps and retries once when the keyboard rejects the client ID', async () => {
        let rejectedOnce = false;
        const { device, issued, sent } = makeDevice((clientId, payload, reply) => {
            if (!rejectedOnce) { rejectedOnce = true; reply(errorFrame(clientId, CLIENT_ERR_INVALID_ID)); return; }
            // Echo a VIA custom-value GET: [0x08][channel][id][data...]
            reply(viaFrame(clientId, [payload[0], payload[1], payload[2], 42, 0]));
        });
        const usb = new SvilUSB();
        await usb.openDevice(device as unknown as HIDDevice);
        const data = await usb.customValueGet(0x53, 0x11, 2);
        expect(Array.from(data)).toEqual([42, 0]);
        // bootstrap, command (rejected), bootstrap, command (answered)
        expect(sent.length).toBe(4);
        expect(issued.length).toBe(2);
        expect(usb.getClientLease().clientId).toBe(issued[1]);
        // the retried command carried the new ID
        const last = sent[3];
        expect(last[1] | (last[2] << 8) | (last[3] << 16) | (last[4] << 24)).toBe(issued[1]);
    });

    it('renews no later than 50 s even though the keyboard advertises 120 s', async () => {
        const { device } = makeDevice((clientId, payload, reply) => reply(viaFrame(clientId, [payload[0], payload[1], payload[2], 1])));
        const usb = new SvilUSB();
        await usb.openDevice(device as unknown as HIDDevice);
        const before = Date.now();
        await usb.customValueGet(0x53, 0x10, 1);
        const lease = usb.getClientLease();
        expect(lease.clientId).not.toBe(0);
        expect(lease.expiresAt - before).toBeLessThanOrEqual(50_100);
        expect(lease.expiresAt - before).toBeGreaterThan(40_000);
        await usb.close();
    });

    it('shares one bootstrap between concurrent commands', async () => {
        const { device, issued } = makeDevice((clientId, payload, reply) => reply(viaFrame(clientId, [payload[0], payload[1], payload[2], 7])));
        const usb = new SvilUSB();
        await usb.openDevice(device as unknown as HIDDevice);
        await Promise.all([usb.customValueGet(0x53, 0x10, 1), usb.customValueGet(0x53, 0x11, 1), usb.customValueGet(0x53, 0x10, 1)]);
        expect(issued.length).toBe(1);
        await usb.close();
    });
});

describe('SvilUSB openDevice on Linux', () => {
    it('reports a refused open as LinuxHidAccessError with the udev fix', async () => {
        const ua = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0.0.0');
        try {
            const { device } = makeDevice(() => {});
            device.open.mockRejectedValueOnce(new DOMException('Failed to open the device.', 'NotAllowedError'));
            const usb = new SvilUSB();
            const failure = await usb.openDevice(device as unknown as HIDDevice).catch((e: unknown) => e);
            expect(failure).toBeInstanceOf(LinuxHidAccessError);
            expect((failure as LinuxHidAccessError).udevCommand).toContain('ATTRS{idProduct}=="404[4-9a-d]"');
        } finally {
            ua.mockRestore();
        }
    });
});
