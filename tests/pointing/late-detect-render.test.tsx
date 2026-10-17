import { act, render } from "@testing-library/react";
import { useCallback, useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSvalboardPointingKbinfo, POINTING_FRAGMENT_IDS as ID, POINTING_INSTANCE_IDX as IDX } from "../fixtures/fragments.fixture";

// The real Keyboard and PointingLayer, with the device drawing replaced by a
// recorder: what is drawn, where, and with which ball.
const mocks = vi.hoisted(() => ({
    ctx: { keyboard: null as any, isConnected: true, connectionSessionId: 1 },
    drawn: [] as { kind: string; x: number; y: number; ball: string }[],
    notify: vi.fn(),
}));
vi.mock("@/contexts/KeyboardContext", () => ({ useKeyboard: () => mocks.ctx }));
vi.mock("@/components/pointing-viz/PointingDevice", () => ({
    PointingDevice: (p: { placement: { kind: string; x: number; y: number }; ball: string }) => {
        mocks.drawn.push({ kind: p.placement.kind, x: p.placement.x, y: p.placement.y, ball: p.ball });
        return <div data-testid={`device-${p.placement.kind}`} />;
    },
}));
vi.mock("@/features/trainer/host-pointing", () => ({ notifyHostPointingLook: mocks.notify }));
vi.mock("@/contexts/LayoutSettingsContext", () => ({
    useLayoutSettings: () => ({
        internationalLayout: "us", keyVariant: "default", fingerClusterSqueeze: 0,
        is3DMode: false, isThumb3DOffsetActive: false, backdropOpacity: 0.45,
    }),
}));
vi.mock("@/contexts/SettingsContext", () => ({ useSettings: () => ({ getSetting: () => false }) }));
vi.mock("@/contexts/KeyBindingContext", () => ({
    useKeyBinding: () => ({ selectKeyboardKey: vi.fn(), selectedTarget: null, clearSelection: vi.fn(), assignKeycode: vi.fn() }),
}));
vi.mock("@/contexts/PanelsContext", () => ({ usePanels: () => ({ activePanel: null, itemToEdit: null }) }));
vi.mock("@/hooks/useOpenBindingEditor", () => ({ useOpenBindingEditor: () => vi.fn() }));
vi.mock("@/hooks/useChanges", () => ({ useChanges: () => ({ hasPendingChangeForKey: () => false }) }));
vi.mock("@/hooks/useKeyDrag", () => ({
    useKeyDrag: () => ({
        handleMouseEnter: () => { }, handleMouseLeave: () => { }, handleMouseDown: () => { }, handleMouseUp: () => { },
        isDragHover: false, isDragSource: false, currentUnitSize: 60,
    }),
}));
vi.mock("@/components/ui/tooltip", () => ({
    Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
    TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
    TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/services/sval.service", () => ({ svalService: { getLayerName: (_k: unknown, l: number) => `Layer ${l}` } }));

import { Keyboard } from "@/components/Keyboard";
import { ComboPreviewProvider } from "@/contexts/ComboPreviewContext";
import { usePointingDetection } from "@/hooks/usePointingDetection";
import { keyboardService } from "@/services/keyboard.service";
import { setBall } from "@/services/pointing-look.service";
import { POINTING_DETECT_INTERVAL_MS as STEP, type PointingDetectDeps } from "@/services/pointing-detect.service";
import type { KeyboardInfo } from "@/types/keyboard.types";
import { appStorage } from "@/utils/app-storage";

const board = { hw: new Map<number, number>() };
const deps: PointingDetectDeps = { readHardwareDetection: vi.fn(async () => new Map(board.hw)) };
const at = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

function boardWith(hw: [number, number][]): KeyboardInfo {
    const kb = createSvalboardPointingKbinfo({ hwDetection: hw }) as KeyboardInfo;
    kb.keylayout = keyboardService.getFragmentComposer().composeLayout(kb) as KeyboardInfo["keylayout"];
    return kb;
}

function Harness({ initial, showPointing }: { initial: KeyboardInfo; showPointing: boolean }) {
    const [kb, setKb] = useState(initial);
    mocks.ctx.keyboard = kb;
    usePointingDetection({
        connected: true,
        boardLoad: 1,
        getKeyboard: () => kb,
        apply: useCallback((patch) => setKb((k) => patch(k)), []),
        deps,
    });
    return (
        <ComboPreviewProvider>
            <Keyboard keyboard={kb as any} selectedLayer={0} setSelectedLayer={vi.fn()} instanceId="main" showPointing={showPointing} />
        </ComboPreviewProvider>
    );
}

const lastDrawn = () => {
    const out: Record<string, { kind: string; x: number; y: number; ball: string }> = {};
    for (const d of mocks.drawn) out[d.kind] = d;
    return out;
};

describe("a pointing module found after connect, in the layout", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        mocks.drawn.length = 0;
        mocks.notify.mockClear();
        board.hw = new Map([[IDX.left, ID.pointing_none], [IDX.right, ID.pointing_none]]);
        appStorage.clear?.();
        // The saved ball for this board's right hand.
        setBall("5a5a5a5a5a5a5a5a", "right", "red");
    });
    afterEach(() => {
        vi.useRealTimers();
        appStorage.clear?.();
    });

    it("render on: draws the device found late as it would at connect, with the saved ball, and tells the overlay the look", async () => {
        // Reference: the same board with the trackball there at connect.
        const atConnect = render(<Harness initial={boardWith([[IDX.left, ID.pointing_none], [IDX.right, ID.pointing_trackball_pmw3389]])} showPointing />);
        const expected = lastDrawn().ball;
        expect(expected).toMatchObject({ kind: "ball", ball: "red" });
        atConnect.unmount();
        mocks.drawn.length = 0;
        mocks.notify.mockClear();

        const { queryByTestId } = render(<Harness initial={boardWith([[IDX.left, ID.pointing_none], [IDX.right, ID.pointing_none]])} showPointing />);
        expect(queryByTestId("device-ball")).toBeNull();
        expect(mocks.notify).not.toHaveBeenCalled();

        board.hw = new Map([[IDX.left, ID.pointing_none], [IDX.right, ID.pointing_trackball_pmw3389]]);
        await at(STEP);
        expect(queryByTestId("device-ball")).not.toBeNull();
        expect(queryByTestId("device-pad")).toBeNull();
        expect(lastDrawn().ball).toEqual(expected);
        expect(mocks.notify).toHaveBeenCalledWith("5a5a5a5a5a5a5a5a", expect.objectContaining({ right: "red" }), expect.any(Number), expect.any(Number));
    });

    it("render off: a late find draws nothing", async () => {
        const { container } = render(<Harness initial={boardWith([[IDX.left, ID.pointing_none], [IDX.right, ID.pointing_none]])} showPointing={false} />);
        board.hw = new Map([[IDX.left, ID.pointing_touchpad_azoteq], [IDX.right, ID.pointing_trackball_pmw3389]]);
        await at(STEP);
        expect(deps.readHardwareDetection).toHaveBeenCalled();
        expect(mocks.drawn).toHaveLength(0);
        expect(container.querySelector("[data-pointing-layer]")).toBeNull();
    });
});
