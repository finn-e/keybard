import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

const notify = vi.hoisted(() => vi.fn());
const devices = vi.hoisted(() => vi.fn());

vi.mock("@/features/trainer/host-pointing", () => ({ notifyHostPointingLook: notify }));
vi.mock("@/hooks/usePointingDevices", () => ({
    usePointingKinds: () => ({ left: "touchpad", right: "trackball" }),
    usePointingLive: () => ({ source: "demo", feed: null, sniper: false, boost: false }),
}));
vi.mock("@/services/pointing-look.service", () => ({
    useBalls: () => ({ left: "silver", right: "black" }),
    setBall: vi.fn(),
}));
vi.mock("@/features/pointing-demo", () => ({ pointingDemo: () => null }));
vi.mock("@/utils/pointing-geometry", () => ({ placeDevice: () => ({ x: 0, y: 0, w: 2, h: 2, corner: "tl" }) }));
vi.mock("@/components/pointing-viz/PointingDevice", () => ({
    PointingDevice: (p: { gloss: number; sparkle: number }) => {
        devices(p.gloss, p.sparkle);
        return null;
    },
}));

import { PointingLayer } from "@/components/pointing-viz/PointingLayer";
import { BALL_GLOSS, BALL_SPARKLE, SPARKLE_DEFAULT } from "@/components/pointing-viz/webgl/materials";
import { appStorage } from "@/utils/app-storage";
import type { KeyboardInfo } from "@/types/keyboard.types";

describe("pointing look sent to Keybard Overlay", () => {
    it("draws and sends the fixed gloss (1) and sparkle (its default), ignoring saved slider values", () => {
        appStorage.setItem("keyboard-settings", JSON.stringify({ "pointing-ball-gloss": 0.1, "pointing-sparkle": 0.2 }));
        vi.useFakeTimers();
        const keyboard = { kbid: "abc", keymap: [] } as unknown as KeyboardInfo;
        render(<PointingLayer keyboard={keyboard} keys={[]} unitPx={45} />);
        expect(notify).toHaveBeenCalledWith("abc", { left: "silver", right: "black" }, 1, SPARKLE_DEFAULT);
        expect(BALL_GLOSS).toBe(1);
        expect(BALL_SPARKLE).toBe(SPARKLE_DEFAULT);
        for (const [gloss, sparkle] of devices.mock.calls) {
            expect(gloss).toBe(1);
            expect(sparkle).toBe(SPARKLE_DEFAULT);
        }
        expect(devices).toHaveBeenCalled();
        vi.useRealTimers();
        appStorage.removeItem("keyboard-settings");
    });
});
