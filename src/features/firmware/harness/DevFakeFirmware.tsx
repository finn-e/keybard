// Development only (?fwfake=1): Settings > Firmware against the mock board, as the harness
// runs it. &running=v3|x4|v2  &nochord=1  &fault=...  &speed=4  &differ=1

import { useCallback, useEffect, useState, type ReactNode } from "react";

import type { FirmwareReleasePin } from "@/constants/firmware-releases";
import type { Fault } from "@/services/updater/fake-board";
import { FakeHost, fakeSetup, fixtureRelease, type FixtureRelease } from "@/services/updater/fake-host";
import { HAND_LEFT, HAND_RIGHT, type Hand } from "@/services/updater/protocol";
import { readBoardSummary, type BoardSummary } from "../board-summary";
import { FirmwareUpdateProvider } from "../FirmwareUpdateProvider";
import type { FirmwareUiHost, UpdateBackup } from "../useFirmwareUpdate";
import { pinOf, ScaledClock } from "./HarnessApp";

class DevFakeHost extends FakeHost implements FirmwareUiHost {
    async makeBackup({ fromTag }: { fromTag: string }): Promise<UpdateBackup> {
        await this.clock.sleep(400);
        return { fileName: `Kip-${fromTag}-2026-10-15.svil`, svil: "{}" };
    }
    async prepareRows() { return []; }
    boardName() { return "Kip"; }
    chordLegends(hand: Hand): [string, string] { return hand === HAND_RIGHT ? ["M", ","] : ["V", "C"]; }
}

interface Ready {
    host: DevFakeHost;
    releases: FirmwareReleasePin[];
    byTag: Record<string, FixtureRelease>;
}

export default function DevFakeFirmware({ children }: { children: ReactNode }) {
    const [ready, setReady] = useState<Ready | null>(null);
    useEffect(() => {
        const params = new URLSearchParams(location.search);
        void (async () => {
            const size = 0x1e000;
            const v2 = await fixtureRelease("v2", 2000, { imageLen: size });
            const v3 = await fixtureRelease("v3", 3000, { imageLen: size });
            const x4 = await fixtureRelease("x4", 4000, { imageLen: size, noChord: params.has("nochord") });
            const running = params.get("running") === "x4" ? x4 : params.get("running") === "v2" ? v2 : v3;
            const clock = new ScaledClock(Number(params.get("speed") ?? 4));
            const f = params.get("fault");
            const faults: Fault[] = !f ? [] : f.startsWith("unplug-") ? [{ kind: "unplug", at: f.slice(7) as "other-send" }] : [{ kind: f } as Fault];
            const { board } = fakeSetup({
                clock, running, noChord: params.has("nochord"), faults, usbHand: params.get("usb") === "left" ? HAND_LEFT : HAND_RIGHT,
                chordAfterMs: 3000, otherRunning: params.has("differ") ? { tag: v2.tag, fwVersion: v2.fwVersion } : undefined,
            });
            const host = new DevFakeHost(board, clock);
            const releases = [pinOf(x4, ["One hold approves both halves", "Settings come back after every install", "Faster trackball start"]), pinOf(v3, ["Layer colors per half"])];
            setReady({ host, releases, byTag: { v2, v3, x4 } });
        })();
    }, []);
    const readBoard = useCallback(async (): Promise<BoardSummary | null> => (ready ? readBoardSummary(ready.host.board) : null), [ready]);
    const files = useCallback(async (pin: FirmwareReleasePin) => ready!.byTag[pin.tag].files, [ready]);
    if (!ready) return <>{children}</>;
    return (
        <FirmwareUpdateProvider host={ready.host} readBoard={readBoard} releases={ready.releases} files={files}>
            {children}
        </FirmwareUpdateProvider>
    );
}
