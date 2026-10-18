import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The fingertips of the last overlay drawn (each pad overlay ends with its reticle).
type Dot = { x: number; y: number; press: number };
const drawn: Dot[] = [];
let pending: Dot[] = [];
vi.mock("@/components/pointing-viz/overlay-draw", () => ({
    drawContact: (_ctx: unknown, _hw: number, _hh: number, x: number, y: number, press: number) => { if (press >= 0.02) pending.push({ x, y, press }); },
    drawPadReticle: () => { drawn.splice(0, drawn.length, ...pending); pending = []; },
    drawPills: () => {},
    drawReticle: () => {},
}));

import { PointingDevice, type PointingFeed } from "@/components/pointing-viz/PointingDevice";
import { _setWebGLDisabledForTest } from "@/components/pointing-viz/webgl/renderer";
import type { PadContact } from "@/utils/pointing-contacts";
import type { PointingMotionHalf, PointingMotionReport } from "@/utils/pointing-motion";
import type { DevicePlacement } from "@/utils/pointing-geometry";

const pad: DevicePlacement = { kind: "pad", side: "left", cx: 4, cy: 5, dU: 2.3, sizeU: 2.6, view: 1.3, w: 2.3, h: 2.1, corner: 0.26 };
const half = (contacts?: PadContact[]): PointingMotionHalf => ({
    valid: true, scrolling: false, saturated: false, autoMouse: false, touchValid: false, fingers: 0,
    dx: 0, dy: 0, h: 0, v: 0, buttons: 0, touchX: 0, touchY: 0, ...(contacts ? { contacts } : {}),
});
const report = (left: PointingMotionHalf): PointingMotionReport => ({
    sniper: false, boost: false, autoMouseLayer: false, axisLockEnabled: false, naturalScroll: false, scrollKey: false,
    elapsedMs: 16, axisLock: "free", left, right: half(),
});

let frames: FrameRequestCallback[] = [];
let clock = 0;
function runFrames(n: number) {
    for (let i = 0; i < n; i++) {
        const queue = frames; frames = [];
        clock += 16;
        for (const f of queue) f(clock);
    }
}

beforeEach(() => {
    _setWebGLDisabledForTest(true);
    frames = []; clock = 1000; drawn.length = 0;
    vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => { frames.push(f); return frames.length; });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    // A 2D context where every call is a no-op (jsdom has no canvas).
    const ctx = new Proxy({}, { get: (_t, k) => (k === "canvas" ? undefined : () => ({ addColorStop() {} })), set: () => true });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as never);
});
afterEach(() => { _setWebGLDisabledForTest(false); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function mount() {
    let send: (r: PointingMotionReport) => void = () => {};
    const feed: PointingFeed = { subscribe: (l) => { send = (r) => l(r, 16); return () => {}; } };
    render(<PointingDevice placement={pad} unitPx={45} ball="silver" gloss={0.25} sparkle={0.75} theme="light" feed={feed}
        sniper={false} boost={false} showModes={false} labels={{ sniper: "", boost: "" }} pillColors={{ bg: "#000", fg: "#fff" }} />);
    return (r: PointingMotionReport) => act(() => send(r));
}

describe("the drawn touchpad with contacts from the board", () => {
    it("draws every finger where the board says it is", () => {
        const send = mount();
        send(report(half([
            { id: 1, x: -0.9, y: -0.8, confident: true },
            { id: 2, x: 0.7, y: 0.6, confident: true },
            { id: 3, x: 0, y: 0.95, confident: true },
        ])));
        runFrames(20);
        expect(drawn).toHaveLength(3);
        expect(drawn.map((d) => [d.x, d.y])).toEqual([[-0.9, -0.8], [0.7, 0.6], [0, 0.95]]);
        expect(drawn.every((d) => d.press === 1)).toBe(true);
    });

    it("moves a finger with its contact and lifts the ones that are gone", () => {
        const send = mount();
        send(report(half([{ id: 1, x: -0.5, y: 0, confident: true }, { id: 2, x: 0.5, y: 0, confident: true }])));
        runFrames(20);
        send(report(half([{ id: 2, x: 0.6, y: 0.1, confident: true }])));
        runFrames(20);
        expect(drawn.map((d) => [d.x, d.y])).toEqual([[0.6, 0.1]]);
        send(report(half([])));
        runFrames(20);
        expect(drawn).toHaveLength(0);
    });

    it("ignores dx/dy on a pad that reports contacts (no stray fingertip in a corner)", () => {
        const send = mount();
        send(report({ ...half([{ id: 4, x: 0.25, y: -0.25, confident: true }]), dx: -5000, dy: 5000 }));
        runFrames(20);
        expect(drawn.map((d) => [d.x, d.y])).toEqual([[0.25, -0.25]]);
    });
});
