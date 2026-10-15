import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/usePointingDevices", async (orig) => {
    const real = await orig<typeof import("@/hooks/usePointingDevices")>();
    return { ...real, usePointingKinds: () => ({ left: "touchpad", right: "trackball" }) };
});

import { BallMenu } from "@/components/pointing-viz/BallMenu";
import { PointingBallPicker } from "@/components/pointing-viz/PointingBallPicker";
import { PointingDevice } from "@/components/pointing-viz/PointingDevice";
import { _setWebGLDisabledForTest } from "@/components/pointing-viz/webgl/renderer";
import { hostHasPointing, hostPointingConfig, hostPointingEvent, hostPointingLook, hostUid, HOST_POINTING_DEFAULTS } from "@/features/trainer/host-pointing";
import { _resetPointingLookForTests, getBall, importBalls, sanitizeBalls, savedBalls, setBall } from "@/services/pointing-look.service";
import { fileService } from "@/services/file.service";
import type { DevicePlacement } from "@/utils/pointing-geometry";

const UID = "1122334455667788";

beforeEach(() => {
    localStorage.clear();
    _resetPointingLookForTests();
    _setWebGLDisabledForTest(true);
    // jsdom has no canvas: draw calls are skipped quietly, as without WebGL
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(() => { _setWebGLDisabledForTest(false); vi.restoreAllMocks(); });

describe("ball color persistence (Fragments and the ball menu share it)", () => {
    it("is kept per board and per hand in this browser, silver by default", () => {
        expect(getBall(UID, "right")).toBe("silver");
        setBall(UID, "right", "pearl_blue");
        expect(getBall(UID, "right")).toBe("pearl_blue");
        expect(getBall(UID, "left")).toBe("silver");
        expect(getBall("ffffffffffffffff", "right")).toBe("silver");
        _resetPointingLookForTests();
        expect(getBall(UID, "right")).toBe("pearl_blue"); // survives a reload
    });

    it("ignores unknown balls from storage or files", () => {
        expect(sanitizeBalls({ left: "gold", right: "red", extra: 1 })).toEqual({ right: "red" });
        importBalls(UID, { left: "pearl_white", right: "nope" });
        expect(savedBalls(UID)).toEqual({ left: "pearl_white" });
    });

    it("travels in .svil files as cosmetic.pointing_balls and comes back on import", () => {
        setBall(UID, "left", "black");
        const kb = { kbid: UID, rows: 10, cols: 6, keymap: [[0]], layers: 1 } as never;
        const svil = JSON.parse(fileService.kbinfoToSvil(kb, false));
        expect(svil.cosmetic.pointing_balls).toEqual({ left: "black" });
    });

    it("the Fragments Ball choice sets the ball for that hand only when it has a trackball", () => {
        render(<><PointingBallPicker side="left" kbid={UID} /><PointingBallPicker side="right" kbid={UID} /></>);
        expect(document.querySelector('[data-pointing-ball-picker="left"]')).toBeNull(); // a touchpad
        const group = screen.getByRole("radiogroup");
        expect(screen.getAllByRole("radio")).toHaveLength(7);
        fireEvent.click(screen.getByRole("radio", { name: /Pearl purple, 52 mm/ }));
        expect(getBall(UID, "right")).toBe("pearl_purple");
        expect(group.querySelector('[aria-checked="true"]')?.getAttribute("data-ball-option")).toBe("pearl_purple");
    });
});

const ballPlacement: DevicePlacement = { kind: "ball", side: "right", cx: 18, cy: 5, dU: 3.8, sizeU: 4.7, view: 1.24 };
const baseProps = {
    placement: ballPlacement, unitPx: 45, ball: "silver" as const, gloss: 0.25, sparkle: 0.75, theme: "light" as const,
    feed: null, sniper: true, boost: false, showModes: true, labels: { sniper: "×0.33", boost: "×2" },
    pillColors: { bg: "#000", fg: "#fff" },
};

describe("the device and its menu", () => {
    it("draws without WebGL (a still stand-in) and labels the ball", () => {
        render(<PointingDevice {...baseProps} />);
        expect(screen.getByRole("img", { name: "Right trackball, Silver sparkle" })).toBeTruthy();
    });

    it("opens the ball menu on right-click, never from the keyboard", () => {
        const onMenu = vi.fn();
        render(<PointingDevice {...baseProps} onMenu={onMenu} />);
        const ball = screen.getByRole("img", { name: /Right trackball/ });
        expect(ball.getAttribute("tabindex")).toBeNull();
        expect(ball.getAttribute("aria-keyshortcuts")).toBeNull();
        for (const key of ["Enter", " ", "ContextMenu", "F10", "m", "b"]) {
            fireEvent.keyDown(ball, { key, shiftKey: key === "F10" });
            fireEvent.keyDown(document, { key, shiftKey: key === "F10" });
        }
        expect(onMenu).not.toHaveBeenCalled();
        fireEvent.contextMenu(ball, { clientX: 10, clientY: 20 });
        expect(onMenu).toHaveBeenCalledWith(10, 20);
    });

    it("opens on a long press on touch screens", () => {
        vi.useFakeTimers();
        const onMenu = vi.fn();
        render(<PointingDevice {...baseProps} onMenu={onMenu} />);
        const ball = screen.getByRole("img", { name: /Right trackball/ });
        fireEvent.pointerDown(ball, { pointerType: "touch", clientX: 5, clientY: 6 });
        act(() => { vi.advanceTimersByTime(600); });
        expect(onMenu).toHaveBeenCalledWith(5, 6);
        vi.useRealTimers();
    });

    it("a touchpad has no menu", () => {
        const onMenu = vi.fn();
        render(<PointingDevice {...baseProps} placement={{ ...ballPlacement, kind: "pad", w: 3.7, h: 3.45, corner: 0.26 }} onMenu={onMenu} />);
        fireEvent.contextMenu(screen.getByRole("img", { name: "Right touchpad" }));
        expect(onMenu).not.toHaveBeenCalled();
    });

    it("the menu lists the seven balls with sizes, marks the current one, and picks", () => {
        const onPick = vi.fn(), onClose = vi.fn();
        render(<BallMenu side="right" current="red" x={10} y={10} onPick={onPick} onClose={onClose} />);
        const items = screen.getAllByRole("menuitemradio");
        expect(items).toHaveLength(7);
        expect(screen.getByRole("menuitemradio", { name: /Glossy red/ }).getAttribute("aria-checked")).toBe("true");
        expect(screen.getByRole("menuitemradio", { name: /Pearl white.*52 mm/ })).toBeTruthy();
        fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
        expect(onClose).toHaveBeenCalled();
        fireEvent.click(screen.getByRole("menuitemradio", { name: /Pearl black/ }));
        expect(onPick).toHaveBeenCalledWith("pearl_black");
    });
});

describe("Keybard Host pointing settings", () => {
    it("defaults: devices off, pills on, cursor multiplier off, also for Hosts without the settings", () => {
        expect(HOST_POINTING_DEFAULTS).toEqual({ showPointing: false, pointingPills: true, cursorMultiplier: false });
        expect(hostPointingConfig({ layoutId: "us" })).toEqual(HOST_POINTING_DEFAULTS);
        expect(hostPointingConfig(null)).toEqual(HOST_POINTING_DEFAULTS);
        expect(hostPointingConfig({ showPointing: true, pointingPills: "yes", cursorMultiplier: true })).toEqual({ showPointing: true, pointingPills: true, cursorMultiplier: true });
        expect(hostHasPointing({ layoutId: "us" })).toBe(false);
        expect(hostHasPointing({ showPointing: false })).toBe(true);
    });

    it("validates the look and the motion events the Host sends", () => {
        expect(hostPointingLook({ left: "pearl_blue", right: "gold", gloss: 2, sparkle: 0.5 })).toEqual({ left: "pearl_blue", gloss: 1, sparkle: 0.5 });
        expect(hostPointingEvent(null)).toBeNull();
        const e = hostPointingEvent({ sniper: true, right: { valid: true, dx: 5, dy: "x" } })!;
        expect(e.sniper).toBe(true);
        expect(e.right).toMatchObject({ valid: true, dx: 5, dy: 0 });
        expect(e.left.valid).toBe(false);
    });

    it("sends the Host's decimal board uid", () => {
        expect(hostUid("1122334455667788")).toBe(BigInt("0x1122334455667788").toString());
        expect(hostUid("5199957870438586395")).toBe("5199957870438586395");
        expect(hostUid("not a uid")).toBeNull();
        expect(hostUid(undefined)).toBeNull();
    });
});
