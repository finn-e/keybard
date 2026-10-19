import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";

import { currentSite, matchPin, parseReleaseTag, releasesForSite, type FirmwareReleasePin } from "@/constants/firmware-releases";
import { FirmwareSection } from "@/features/firmware/FirmwareSection";
import { lightFor } from "@/features/firmware/lights";
import { ProgressView, progressTitle, progressFooter } from "@/features/firmware/ProgressDialog";
import { UpdateDialog, resultTitle } from "@/features/firmware/UpdateDialog";
import { UpdateSheet } from "@/features/firmware/UpdateSheet";
import { useFirmwareUpdate, type FirmwareUiHost } from "@/features/firmware/useFirmwareUpdate";
import { firmwareStatusFor } from "@/features/firmware/useFirmwareStatus";
import { failureCopy } from "@/features/firmware/failures";
import { FakeHost, fakeSetup, fixtureRelease } from "@/services/updater/fake-host";
import { memoryFlowStore, type FlowState, type Step } from "@/services/updater/flow";
import type { Plan } from "@/services/updater/checks";
import { VirtualClock } from "@/services/updater/transport";
import type { BoardSummary } from "@/features/firmware/board-summary";

vi.mock("@/lib/paranoid", () => ({ PARANOID: false, userIsLooking: () => true }));

const rel = (tag: string, fwVersion: number, protocol = 4): FirmwareReleasePin => ({
    tag, kind: tag[0] as "v" | "x", fwVersion, updaterProtocol: protocol,
    files: { left: { svup: "l", uf2: "l.uf2", sha256: `${tag}-l`, size: 1, pid: 0x4044 }, right: { svup: "r", uf2: "r.uf2", sha256: `${tag}-r`, size: 1, pid: 0x4045 } },
    highlights: [`${tag} highlight`], notesUrl: "",
});

describe("carried releases per site", () => {
    const all = [rel("v2", 2000), rel("v3", 3000), rel("v4", 4000), rel("x5", 5000), rel("x4.1", 4100), rel("v1", 1000, 3)];

    it("production offers the newest v and the one before it", () => {
        expect(releasesForSite("production", all).map((r) => r.tag)).toEqual(["v4", "v3"]);
    });

    it("next offers the newest x and the same v releases, newest first", () => {
        expect(releasesForSite("next", all).map((r) => r.tag)).toEqual(["x5", "v4", "v3"]);
    });

    it("dev builds offer every protocol-4 release; protocol-3 ones are never listed", () => {
        expect(releasesForSite("dev", all).map((r) => r.tag)).toEqual(["x5", "x4.1", "v4", "v3", "v2"]);
    });

    it("is empty until a protocol-4 release is pinned", () => {
        expect(releasesForSite("production")).toEqual([]);
        expect(releasesForSite("next")).toEqual([]);
    });

    it("reads the site from the build mode", () => {
        expect(currentSite({ MODE: "svalboard" })).toBe("production");
        expect(currentSite({ MODE: "paranoid" })).toBe("production");
        expect(currentSite({ MODE: "next", VITE_CHANNEL: "next" })).toBe("next");
        expect(currentSite({ MODE: "production", BASE_URL: "/keybard-test/" })).toBe("next");
        expect(currentSite({ MODE: "development" })).toBe("dev");
    });

    it("parses v and x tags only, and matches pins by SHA-256", () => {
        expect(parseReleaseTag("v3.1")).toEqual({ kind: "v", parts: [3, 1] });
        expect(parseReleaseTag("vLaunch2")).toBeNull();
        expect(parseReleaseTag("x3-rc1")).toBeNull();
        expect(matchPin("v3-r", all)?.hand).toBe(1);
        expect(matchPin("nope", all)).toBeNull();
    });
});

function fs(step: Step, o: Partial<FlowState> = {}): FlowState {
    return {
        version: 1, id: "t", phase: "running", target: "both", usbHand: 1, title: "Update to x4", toTag: "x4", fromTag: "v3", files: {},
        afterwards: "restore", backup: null, noChord: false, step, stepAt: 0, approveAt: 0, committed: [], halvesDone: [], approvalsAsked: 1,
        rows: [{ hand: 0, usb: false, stage: "waiting", progress: 0, fromTag: "v3", toTag: "x4" }, { hand: 1, usb: true, stage: "waiting", progress: 0, fromTag: "v3", toTag: "x4" }],
        settingsResetSent: false, sent2A: false, startedAt: 0, finishedAt: null, result: null, failure: null, measurements: {}, ...o,
    };
}

describe("the lights, from the firmware's table (update-flow 5.3)", () => {
    const at = (step: Step, hand: 0 | 1, o?: Partial<FlowState>) => lightFor(fs(step, o), hand, 1000);
    it("blue blinks on the half with USB only while it waits for the chord", () => {
        expect(at("approve", 1)).toBe("blue-blink");
        expect(at("approve", 0)).toBe("layer");
        for (const step of ["other-send", "relay", "self-send", "self-arm"] as Step[]) expect(at(step, 1)).not.toBe("blue-blink");
    });
    it("rainbow while busy; both halves while copying", () => {
        expect(at("other-send", 1)).toBe("rainbow");
        expect(at("relay", 0)).toBe("rainbow");
        expect(at("relay", 1)).toBe("rainbow");
    });
    it("magenta on both halves while the other half installs; red between the halves", () => {
        expect(at("other-install", 0)).toBe("magenta");
        expect(at("other-install", 1)).toBe("magenta");
        expect(at("other-restart", 1)).toBe("red-slow");
        expect(at("self-install", 1)).toBe("magenta");
    });
});

describe("progress titles and footers (5.1)", () => {
    it("names the chord while approving, the install while installing, else updating", () => {
        expect(progressTitle(fs("approve"), ["M", ","])).toBe("Hold M + , on the right half");
        expect(progressTitle(fs("other-install"), ["M", ","])).toBe("Installing · don't unplug");
        expect(progressTitle(fs("relay"), ["M", ","])).toBe("Updating keyboard");
        expect(progressFooter(fs("relay"), 0)).toBe("Don't type on the left half");
        expect(progressFooter(fs("other-restart"), 0)).toBe("Red until this half updates");
    });

    it("shows a swatch and a stage on each row, the other half first", () => {
        render(<ProgressView state={fs("relay", { rows: [{ hand: 1, usb: true, stage: "waiting", progress: 0, fromTag: "v3", toTag: "x4" }, { hand: 0, usb: false, stage: "copying", progress: 0.63, fromTag: "v3", toTag: "x4" }] })} legends={["M", ","]} now={0} />);
        const rows = screen.getAllByRole("listitem");
        expect(rows[0]).toHaveAttribute("data-row", "left");
        expect(rows[0]).toHaveTextContent("Copying to left half 63%");
        expect(screen.getAllByRole("img", { name: /Light: Rainbow/ })).toHaveLength(2);
    });

    it("titles the result", () => {
        expect(resultTitle(fs("done", { title: "Update to x4" }))).toBe("Updated to x4");
        expect(resultTitle(fs("done", { title: "Reinstall v3", toTag: "v3" }))).toBe("Reinstalled v3");
    });

    it("words the failures with their exact next step", () => {
        expect(failureCopy({ id: "F9", tags: { 0: "x4", 1: "v3" } })).toMatchObject({ title: "Halves differ", body: "Left half x4 · Right half v3" });
        expect(failureCopy({ id: "F5" }, { fromTag: "v3" }).body).toBe("Nothing was changed. Your keyboard still runs v3.");
        expect(failureCopy({ id: "F11", hand: 0 }).title).toBe("Left half needs a manual install");
    });
});

const board = (o: Partial<BoardSummary> = {}): BoardSummary => ({
    updater: true, legacyLabel: null, usbHand: 1, differ: false, noChord: false, fwVersion: 3000, tag: "v3",
    halves: [{ hand: 0, usb: false, tag: "v3", fwVersion: 3000, pointing: "Trackball", answered: true }, { hand: 1, usb: true, tag: "v3", fwVersion: 3000, pointing: "No pointing module", answered: true }], ...o,
});

describe("the Firmware page (D2)", () => {
    const releases = [rel("x4", 4000), rel("v3", 3000)];
    it("follows the selected row with the button: update, reinstall, file", () => {
        const onInstall = vi.fn();
        render(<FirmwareSection board={board()} releases={releases} onInstall={onInstall} onManual={vi.fn()} paranoid={false} />);
        expect(screen.getByRole("button", { name: "Update to x4" })).toBeTruthy();
        expect(screen.getByText("Installed")).toBeTruthy();
        fireEvent.click(screen.getAllByRole("radio")[1]);
        expect(screen.getByRole("button", { name: "Reinstall v3" })).toBeTruthy();
        fireEvent.click(screen.getByRole("radio", { name: /Choose a file/ }));
        expect(screen.getByRole("button", { name: "Install file" })).toBeTruthy();
        fireEvent.click(screen.getAllByRole("radio")[0]);
        fireEvent.click(screen.getByRole("button", { name: "Update to x4" }));
        expect(onInstall).toHaveBeenCalledWith({ kind: "release", release: releases[0] });
    });

    it("D2a up to date, D2b manual install, D2c halves differ, D2e no keyboard", () => {
        const { rerender } = render(<FirmwareSection board={board({ fwVersion: 4000, tag: "x4", halves: board().halves.map((h) => ({ ...h, fwVersion: 4000, tag: "x4" })) })} releases={releases} onInstall={vi.fn()} onManual={vi.fn()} paranoid={false} />);
        expect(screen.getByText("Up to date")).toBeTruthy();
        expect(screen.getByRole("button", { name: "Reinstall x4" })).toBeTruthy();
        const onManual = vi.fn();
        rerender(<FirmwareSection board={board({ updater: false, legacyLabel: "Svalboard QMK vLaunch2 or later" })} releases={releases} onInstall={vi.fn()} onManual={onManual} paranoid={false} />);
        fireEvent.click(screen.getByRole("button", { name: "Install x4" }));
        expect(onManual).toHaveBeenCalledWith(releases[0]);
        rerender(<FirmwareSection board={board({ differ: true })} releases={releases} onInstall={vi.fn()} onManual={vi.fn()} paranoid={false} />);
        expect(screen.getByText("Halves differ")).toBeTruthy();
        rerender(<FirmwareSection board={null} releases={releases} onInstall={vi.fn()} onManual={vi.fn()} onConnect={vi.fn()} paranoid={false} />);
        expect(screen.getByText("Connect a keyboard to see its firmware.")).toBeTruthy();
    });

    it("Paranoid offers only Choose a file", () => {
        render(<FirmwareSection board={board()} releases={releases} onInstall={vi.fn()} onManual={vi.fn()} paranoid />);
        expect(screen.getAllByRole("radio")).toHaveLength(1);
        expect(screen.getByRole("button", { name: "Install file" })).toBeTruthy();
    });

    it("the rail dot: an update when a half is behind the newest carried release", () => {
        expect(firmwareStatusFor(board(), releases).updateAvailable).toBe(true);
        expect(firmwareStatusFor(board({ halves: board().halves.map((h) => ({ ...h, fwVersion: 4000 })) }), releases).updateAvailable).toBe(false);
        expect(firmwareStatusFor(board(), []).updateAvailable).toBe(false);
    });
});

describe("the sheet (B1) and the dialog against the mock board", () => {
    let clock: VirtualClock;
    beforeEach(() => { clock = new VirtualClock(); });

    class UiHost extends FakeHost implements FirmwareUiHost {
        backups = 0;
        failBackup = false;
        async makeBackup() { this.backups++; if (this.failBackup) throw new Error("disk full"); return { fileName: "Kip-v3-2026-10-15.svil", svil: "{}" }; }
        boardName() { return "Kip"; }
        chordLegends(): [string, string] { return ["M", ","]; }
    }

    function Harness({ host, source }: { host: UiHost; source: Parameters<ReturnType<typeof useFirmwareUpdate>["openSheet"]>[0] }) {
        const fw = useFirmwareUpdate(host, { store: memoryFlowStore(), releases: [] });
        const [opened, setOpened] = useState(false);
        return (
            <>
                {!opened && <button onClick={() => { setOpened(true); void fw.openSheet(source); }}>Open</button>}
                <UpdateDialog ui={fw.ui} now={() => clock.now()} chordLegends={() => ["M", ","]} cancellable={!!fw.flow?.cancellable} onAfterwards={fw.setAfterwards} onStart={fw.start} onCancel={fw.close} onClose={fw.close} onFailureAction={() => fw.close()} />
            </>
        );
    }

    async function setup(o: { noChord?: boolean; failBackup?: boolean; devFile?: boolean } = {}) {
        const v3 = await fixtureRelease("v3", 3000);
        const x4 = await fixtureRelease("x4", 4000, { noChord: o.devFile });
        const { board: fake } = fakeSetup({ clock, running: v3, noChord: o.noChord });
        const host = new UiHost(fake, clock);
        host.failBackup = !!o.failBackup;
        render(<Harness host={host} source={{ kind: "file", files: [x4.files[0], x4.files[1]] }} />);
        fireEvent.click(screen.getByRole("button", { name: "Open" }));
        await screen.findByTestId("update-sheet");
        return { host, fake };
    }

    it("runs the checks, takes the backup, and enables Update anyway for an unknown file", async () => {
        const { host } = await setup();
        await waitFor(() => expect(screen.getByText("Layout saved")).toBeTruthy());
        expect(host.backups).toBe(1);
        expect(screen.getByText("Unknown firmware file")).toBeTruthy();
        expect(screen.getByText("Hold M + , once, when the light blinks blue")).toBeTruthy();
        expect(screen.getByText("One hold approves both halves")).toBeTruthy();
        const start = screen.getByRole("button", { name: "Update anyway" });
        expect(start).not.toBeDisabled();
    });

    it("on a developer build, says there's nothing to press", async () => {
        await setup({ noChord: true, devFile: true });
        expect(screen.getByText("Nothing to press: this developer build installs without approval")).toBeTruthy();
        expect(screen.getByText("Developer build")).toBeTruthy();
    });

    it("a failed backup switches Keep my layout to the default layout and disables it", async () => {
        await setup({ failBackup: true });
        await waitFor(() => expect(screen.getByText("Layout not saved")).toBeTruthy());
        expect(screen.getByRole("radio", { name: /Keep my layout/ })).toBeDisabled();
        expect(screen.getByRole("radio", { name: "Reset to the default layout" })).toBeChecked();
        expect(screen.getByRole("radio", { name: "Wipe to a blank board" })).not.toBeDisabled();
    });

    it("P4-31 the layout choice: three options, Keep my layout first and chosen", async () => {
        await setup();
        await waitFor(() => expect(screen.getByRole("radio", { name: /Keep my layout/ })).not.toBeDisabled());
        const radios = within(screen.getByRole("group", { name: "Layout" })).getAllByRole("radio");
        expect(radios.map((r) => r.getAttribute("value"))).toEqual(["restore", "defaults", "blank"]);
        expect(screen.getByRole("radio", { name: /Keep my layout/ })).toBeChecked();
        fireEvent.click(screen.getByRole("radio", { name: "Wipe to a blank board" }));
        expect(screen.getByRole("radio", { name: "Wipe to a blank board" })).toBeChecked();
    });

    it("Start runs to the result with no further prompt", async () => {
        const { fake } = await setup();
        await waitFor(() => expect(screen.getByRole("button", { name: "Update anyway" })).not.toBeDisabled());
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Update anyway" })); });
        await screen.findByTestId("update-result", {}, { timeout: 10_000 });
        expect(screen.getByText("Installed custom firmware")).toBeTruthy();
        expect(fake.chordRequests).toBe(1);
    });

    it("P4-31 a blank board doesn't wait for the backup: Start is on while it saves", () => {
        const plan = { board: { usb: { hand: 1 }, noChord: true }, target: "both", title: "Update to x4", toTag: "x4", checks: [], warnings: [], refusal: null, otherSilent: false } as unknown as Plan;
        const sheet = (afterwards: "restore" | "blank") => <UpdateSheet ui={{ kind: "sheet", source: { kind: "file", files: [] }, plan, preFailure: null, backup: { state: "pending" }, afterwards, error: null }} chordLegends={() => ["M", ","]} onAfterwards={vi.fn()} onStart={vi.fn()} onCancel={vi.fn()} />;
        const { rerender } = render(sheet("restore"));
        expect(screen.getByRole("button", { name: "Start update" })).toBeDisabled();
        rerender(sheet("blank"));
        expect(screen.getByRole("button", { name: "Start update" })).not.toBeDisabled();
    });

    it("renders the sheet's integrity refusal with Reload and Close only", () => {
        const plan = { board: { usb: { hand: 1 }, noChord: false }, target: "both", title: "Update to x4", toTag: "x4", checks: [{ id: "integrity", label: "Firmware file failed its check", state: "refuse", detail: "Keybard won't install it. Reload Keybard and try again." }], warnings: [], refusal: { id: "integrity", label: "Firmware file failed its check", state: "refuse" }, otherSilent: false } as unknown as Plan;
        render(<UpdateSheet ui={{ kind: "sheet", source: { kind: "file", files: [] }, plan, preFailure: null, backup: { state: "pending" }, afterwards: "restore", error: null }} chordLegends={() => ["M", ","]} onAfterwards={vi.fn()} onStart={vi.fn()} onCancel={vi.fn()} />);
        expect(screen.getAllByText("Firmware file failed its check")).toHaveLength(1);
        expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
        expect(screen.queryByRole("button", { name: /Start|anyway/ })).toBeNull();
    });
});
