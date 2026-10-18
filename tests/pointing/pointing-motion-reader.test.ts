import { describe, expect, it, vi } from "vitest";

import { KeyboardService } from "@/services/keyboard.service";
import { SvilUSB } from "@/services/usb.service";
import type { KeyboardInfo } from "@/types/keyboard.types";

/** A motion reply on a 64-byte report: dx 7 on the left, at 1200 CPI where given. */
function motionReply(cpi = 0) {
    const buf = new Uint8Array(57 + 2), view = new DataView(buf.buffer);
    buf[0] = 0x2d; buf[1] = 1; buf[4] = 1; view.setInt16(5, 7, true);
    view.setUint16(26, cpi, true);
    return buf;
}

function service(reply: Uint8Array) {
    const usb = { sendSvil: vi.fn(async () => reply) };
    return { usb, kb: new KeyboardService(usb as unknown as SvilUSB) };
}

describe("Keybard's POINTING_MOTION reads", () => {
    it("name reader 1 where the board keeps counts per reader, and take its CPI", async () => {
        const { usb, kb } = service(motionReply(1200));
        const r = await kb.getPointingMotion({ feature_flags2: 0x18 } as KeyboardInfo);
        expect(usb.sendSvil).toHaveBeenCalledWith(0x2d, [1], { uint8: true });
        expect(r!.left).toMatchObject({ valid: true, dx: 7, cpi: 1200 });
    });

    it("stay legacy (no reader byte) on firmware without per-reader counts", async () => {
        const { usb, kb } = service(motionReply());
        const r = await kb.getPointingMotion({ feature_flags2: 0x08 } as KeyboardInfo);
        expect(usb.sendSvil).toHaveBeenCalledWith(0x2d, [], { uint8: true });
        expect(r!.left.cpi).toBeUndefined();
    });

    it("send nothing on firmware without 0x2D", async () => {
        const { usb, kb } = service(motionReply());
        expect(await kb.getPointingMotion({ feature_flags2: 0x10 } as KeyboardInfo)).toBeNull();
        expect(usb.sendSvil).not.toHaveBeenCalled();
    });
});
