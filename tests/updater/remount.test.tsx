// The editor unmounts on every reconnect (Keybard shows the connect screen while the
// keyboard reloads), so the update's controller remounts twice during a wipe: after the
// install and after SETTINGS_RESET. The update must carry on as one flow and end on its
// result, with one SETTINGS_RESET and one 0x2A.
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";

import { UpdateDialog } from "@/features/firmware/UpdateDialog";
import { useFirmwareUpdate, type FirmwareUiHost } from "@/features/firmware/useFirmwareUpdate";
import { FakeHost, fakeSetup, fixtureRelease } from "@/services/updater/fake-host";
import { memoryFlowStore, UpdateFlow, type FlowStore } from "@/services/updater/flow";
import { Op } from "@/services/updater/protocol";
import type { UpdaterTransport } from "@/services/updater/transport";
import { VirtualClock } from "@/services/updater/transport";

vi.mock("@/lib/paranoid", () => ({ PARANOID: false, userIsLooking: () => true }));

class RemountingHost extends FakeHost implements FirmwareUiHost {
    /** Called when the keyboard comes back: the app swaps the editor out and back in then. */
    onReconnect: (() => void) | null = null;
    async waitForDevice(timeoutMs: number): Promise<UpdaterTransport | null> {
        const t = await super.waitForDevice(timeoutMs);
        if (t) this.onReconnect?.();
        return t;
    }
    async makeBackup() { return { fileName: "Kip-v3-2026-10-15.svil", svil: "{}" }; }
    boardName() { return "Kip"; }
    chordLegends(): [string, string] { return ["M", ","]; }
}

function Editor({ host, store, source, clock }: { host: RemountingHost; store: FlowStore; source: Parameters<ReturnType<typeof useFirmwareUpdate>["openSheet"]>[0]; clock: VirtualClock }) {
    const fw = useFirmwareUpdate(host, { store, releases: [] });
    return (
        <>
            {fw.ui.kind === "idle" && <button onClick={() => void fw.openSheet(source)}>Open</button>}
            <UpdateDialog ui={fw.ui} now={() => clock.now()} chordLegends={() => ["M", ","]} cancellable={!!fw.flow?.cancellable} onAfterwards={fw.setAfterwards} onStart={fw.start} onCancel={fw.close} onClose={fw.close} onFailureAction={() => fw.close()} />
        </>
    );
}

describe("an update while the editor remounts on each reconnect", () => {
    it("Wipe to a blank board runs as one flow to its result: one SETTINGS_RESET, one 0x2A, no second run", async () => {
        const clock = new VirtualClock();
        const v3 = await fixtureRelease("v3", 3000);
        const x4 = await fixtureRelease("x4", 4000, { noChord: true });
        const { board } = fakeSetup({ clock, running: v3, noChord: true });
        const host = new RemountingHost(board, clock);
        const store = memoryFlowStore();
        const source = { kind: "file" as const, files: [x4.files[0], x4.files[1]] };
        let remounts = 0;
        function App() {
            const [gen, setGen] = useState(0);
            host.onReconnect = () => { remounts++; setGen((g) => g + 1); };
            return <Editor key={gen} host={host} store={store} source={source} clock={clock} />;
        }
        const runs = vi.spyOn(UpdateFlow.prototype, "run");
        render(<App />);
        fireEvent.click(screen.getByRole("button", { name: "Open" }));
        await screen.findByTestId("update-sheet");
        fireEvent.click(await screen.findByRole("radio", { name: "Wipe to a blank board" }));
        const start = await screen.findByRole("button", { name: /Update anyway|Start update/ });
        await waitFor(() => expect(start).not.toBeDisabled());
        await act(async () => { fireEvent.click(start); });
        await screen.findByTestId("update-result", {}, { timeout: 10_000 });
        // Let any second copy of the flow finish what it started.
        await act(async () => { for (let i = 0; i < 50; i++) await clock.sleep(1000); });
        expect(remounts).toBeGreaterThanOrEqual(2);
        // The remounted editor shows the running flow; it never starts a second copy from the saved state.
        expect(runs).toHaveBeenCalledTimes(1);
        runs.mockRestore();
        expect(board.requests.filter((r) => r.op === Op.SETTINGS_RESET)).toHaveLength(1);
        expect(host.events.filter((e) => e === "0x2A")).toHaveLength(1);
        expect(store.load()?.state.phase).toBe("result");
        expect(screen.getByTestId("update-result")).toBeTruthy();
        expect(board.storageFlags & 4).toBe(0);
    });
});
