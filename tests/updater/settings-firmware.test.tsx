// M3: Settings > Firmware is the entry to the update flow; the chord legends come from the board.
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BoardSummary } from "@/features/firmware/board-summary";
import type { FirmwareUpdates } from "@/features/firmware/FirmwareUpdateProvider";
import { chordLegendsFor } from "@/features/firmware/useAppFirmwareHost";
import { KEYMAP } from "@/constants/keygen";
import type { KeyboardInfo } from "@/types/keyboard.types";

const ctx = vi.hoisted(() => ({ updates: null as FirmwareUpdates | null, connected: true }));
vi.mock("@/features/firmware/FirmwareUpdateProvider", () => ({ useFirmwareUpdates: () => ctx.updates }));
vi.mock("@/contexts/KeyboardContext", () => ({ useKeyboard: () => ({ keyboard: null, isConnected: ctx.connected }) }));

import FirmwareRow from "@/layout/SecondarySidebar/Panels/settings/FirmwareRow";

const board: BoardSummary = {
    updater: true, legacyLabel: null, usbHand: 1, differ: false, noChord: false, fwVersion: 3000, tag: "v3",
    halves: [
        { hand: 0, usb: false, tag: "v3", fwVersion: 3000, pointing: "Trackball", answered: true },
        { hand: 1, usb: true, tag: "v3", fwVersion: 3000, pointing: "Trackball", answered: true },
    ],
};

function updates(o: Partial<FirmwareUpdates> = {}): FirmwareUpdates {
    return {
        board, reading: false, releases: [], install: vi.fn(), openManual: vi.fn(), connect: vi.fn(),
        status: { newest: null, updateAvailable: false, dot: false, markSeen: vi.fn() },
        ...o,
    };
}

beforeEach(() => { ctx.updates = updates(); ctx.connected = true; });

describe("Settings > Firmware", () => {
    it("shows the board's halves and the install list, under the section's own title", () => {
        render(<FirmwareRow />);
        expect(screen.getByTestId("firmware-section")).toBeTruthy();
        expect(screen.queryByRole("heading", { name: "Firmware" })).toBeNull(); // Settings titles the section
        expect(screen.getByRole("radiogroup", { name: "Install" })).toBeTruthy();
        expect(screen.getByRole("button", { name: "Install file" })).toBeTruthy();
    });

    it("says it's reading while the board's firmware is read", () => {
        ctx.updates = updates({ board: null, reading: true });
        render(<FirmwareRow />);
        expect(screen.getByText("Reading the keyboard's firmware…")).toBeTruthy();
    });

    it("opening it clears the update dot for this release", () => {
        const markSeen = vi.fn();
        ctx.updates = updates({ status: { newest: null, updateAvailable: true, dot: true, markSeen } });
        render(<FirmwareRow />);
        expect(markSeen).toHaveBeenCalledTimes(1);
    });
});

describe("chord legends", () => {
    const kb = (layer0: number[]) => ({ rows: 10, cols: 6, keymap: [layer0] }) as unknown as KeyboardInfo;
    const at = (row: number, col: number) => row * 6 + col;

    it("come from the board's layer 0 at Index South and Middle South", () => {
        const layer0 = new Array(60).fill(KEYMAP.KC_A.code);
        layer0[at(6, 0)] = KEYMAP.KC_J.code;
        layer0[at(7, 0)] = KEYMAP.KC_K.code;
        layer0[at(1, 0)] = KEYMAP.KC_F.code;
        layer0[at(2, 0)] = KEYMAP.KC_D.code;
        expect(chordLegendsFor(kb(layer0), 1)).toEqual(["J", "K"]);
        expect(chordLegendsFor(kb(layer0), 0)).toEqual(["F", "D"]);
    });

    it("name the place on a blank board, and fall back to the default letters with no keymap", () => {
        expect(chordLegendsFor(kb(new Array(60).fill(0)), 1)).toEqual(["Index South", "Middle South"]);
        expect(chordLegendsFor(null, 1)).toEqual(["M", ","]);
        expect(chordLegendsFor(null, 0)).toEqual(["V", "C"]);
    });
});
