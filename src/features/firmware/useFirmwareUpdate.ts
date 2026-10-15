// The update dialog's controller: the sheet (checks + backup), then the flow, then the result.

import { useCallback, useEffect, useRef, useState } from "react";

import { planInstall, type CheckRow, type InstallSource, type Plan, type PreFailure } from "@/services/updater/checks";
import { UpdaterClient } from "@/services/updater/client";
import { sessionFlowStore, UpdateFlow, type Afterwards, type FlowHost, type FlowState, type FlowStore } from "@/services/updater/flow";
import { otherHand, type Hand } from "@/services/updater/protocol";
import { CARRIED_RELEASES, type FirmwareReleasePin } from "@/constants/firmware-releases";

export interface UpdateBackup {
    snapshotId?: string;
    fileName: string;
    svil: string;
}

/** The flow host plus what the sheet needs from the app. */
export interface FirmwareUiHost extends FlowHost {
    /** Back up the board: a pre-update snapshot and a downloaded file, parsed back. Throws on failure. */
    makeBackup(info: { fromTag: string; toTag: string }): Promise<UpdateBackup>;
    /** Pause Keybard Host, close Scan Lab, Linux device access: extra check rows. */
    prepareRows?(): Promise<CheckRow[]>;
    boardName(): string;
    /** The two chord keys' layer-0 legends on a half (Index South + Middle South). */
    chordLegends(hand: Hand): [string, string];
}

export type BackupStatus = { state: "pending" } | { state: "ok"; fileName: string; backup: UpdateBackup } | { state: "failed"; error: string };

export type UpdateUi =
    | { kind: "idle" }
    | {
        kind: "sheet";
        source: InstallSource;
        onlyHand?: Hand;
        plan: Plan | null;
        preFailure: PreFailure | null;
        backup: BackupStatus;
        afterwards: Afterwards;
        error: string | null;
    }
    | { kind: "flow"; state: FlowState };

export interface UseFirmwareUpdateOptions {
    store?: FlowStore;
    releases?: FirmwareReleasePin[];
    maxSvalProtocol?: number;
}

export function useFirmwareUpdate(host: FirmwareUiHost | null, o: UseFirmwareUpdateOptions = {}) {
    const [ui, setUi] = useState<UpdateUi>({ kind: "idle" });
    const storeRef = useRef<FlowStore>(o.store ?? sessionFlowStore());
    const flowRef = useRef<UpdateFlow | null>(null);
    const hostRef = useRef(host);
    hostRef.current = host;
    const lastSource = useRef<{ source: InstallSource; onlyHand?: Hand } | null>(null);
    const releases = o.releases ?? CARRIED_RELEASES;

    const runFlow = useCallback((flow: UpdateFlow) => {
        flowRef.current = flow;
        setUi({ kind: "flow", state: flow.state });
        flow.subscribe((state) => setUi({ kind: "flow", state }));
        void flow.run();
    }, []);

    // A reload mid-update picks the flow back up from sessionStorage.
    useEffect(() => {
        if (!host || flowRef.current) return;
        let cancelled = false;
        void UpdateFlow.restore(host, storeRef.current).then((flow) => {
            if (!cancelled && flow && !flowRef.current) runFlow(flow);
        }).catch((error) => console.warn("[firmware] couldn't resume the update", error));
        return () => { cancelled = true; };
    }, [host, runFlow]);

    const openSheet = useCallback(async (source: InstallSource, onlyHand?: Hand) => {
        const h = hostRef.current;
        if (!h) return;
        lastSource.current = { source, onlyHand };
        setUi({ kind: "sheet", source, onlyHand, plan: null, preFailure: null, backup: { state: "pending" }, afterwards: "restore", error: null });
        const t = h.transport();
        if (!t) {
            setUi((u) => (u.kind === "sheet" ? { ...u, error: "Connect your keyboard first." } : u));
            return;
        }
        try {
            const rows = (await h.prepareRows?.().catch(() => [])) ?? [];
            const result = await planInstall(new UpdaterClient(t), source, { clock: h.clock, onlyHand, releases, maxSvalProtocol: o.maxSvalProtocol, hostRows: rows });
            if ("id" in result) {
                setUi((u) => (u.kind === "sheet" ? { ...u, preFailure: result } : u));
                return;
            }
            setUi((u) => (u.kind === "sheet" ? { ...u, plan: result } : u));
            try {
                const backup = await h.makeBackup({ fromTag: result.fromTag, toTag: result.toTag });
                setUi((u) => (u.kind === "sheet" ? { ...u, backup: { state: "ok", fileName: backup.fileName, backup } } : u));
            } catch (error) {
                // Gentle: warn, and switch Afterwards to defaults (Q8).
                setUi((u) => (u.kind === "sheet" ? { ...u, backup: { state: "failed", error: error instanceof Error ? error.message : String(error) }, afterwards: "defaults" } : u));
            }
        } catch (error) {
            setUi((u) => (u.kind === "sheet" ? { ...u, error: error instanceof Error ? error.message : String(error) } : u));
        }
    }, [releases, o.maxSvalProtocol]);

    const setAfterwards = useCallback((afterwards: Afterwards) => {
        setUi((u) => (u.kind === "sheet" && (afterwards === "defaults" || u.backup.state === "ok") ? { ...u, afterwards } : u));
    }, []);

    const start = useCallback(() => {
        const h = hostRef.current;
        if (!h || ui.kind !== "sheet" || !ui.plan || ui.plan.refusal || ui.backup.state === "pending") return;
        const backup = ui.backup.state === "ok" ? ui.backup.backup : null;
        runFlow(UpdateFlow.create(h, storeRef.current, { plan: ui.plan, afterwards: ui.afterwards, backup }));
    }, [ui, runFlow]);

    const close = useCallback(() => {
        if (ui.kind === "flow" && ui.state.phase === "running") return; // nothing closes a running update
        flowRef.current?.dismiss();
        flowRef.current = null;
        setUi({ kind: "idle" });
    }, [ui]);

    const retry = useCallback(() => {
        const last = lastSource.current;
        flowRef.current?.dismiss();
        flowRef.current = null;
        if (last) void openSheet(last.source, last.onlyHand);
        else setUi({ kind: "idle" });
    }, [openSheet]);

    /** F9: a one-half update of the half that didn't get the new release, with its own sheet and chord. */
    const finish = useCallback(() => {
        const last = lastSource.current;
        if (ui.kind !== "flow" || !last) return;
        const s = ui.state;
        const stale = ([0, 1] as Hand[]).find((h) => !s.committed.includes(h) && s.files[h]) ?? otherHand(s.usbHand);
        flowRef.current?.dismiss();
        flowRef.current = null;
        void openSheet(last.source, stale);
    }, [ui, openSheet]);

    return { ui, openSheet, setAfterwards, start, close, retry, finish, flow: flowRef.current };
}
