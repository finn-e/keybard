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

/** The tab's own store: one per tab, so a remounted controller finds the same update. */
let tabStore: FlowStore | null = null;

/**
 * The flow running in this page, per store. The editor unmounts while the keyboard
 * reconnects (it shows the connect screen until the layout loads), so the controller
 * remounts mid-update, twice for a wipe. The remounted one shows this flow; it never
 * starts a second copy from the saved state, which would act on the board alongside it.
 */
const liveFlows = new WeakMap<FlowStore, UpdateFlow>();
/** What the last sheet installed, per store, for Try again and Finish update after a remount. */
const lastSources = new WeakMap<FlowStore, { source: InstallSource; onlyHand?: Hand }>();

export function useFirmwareUpdate(host: FirmwareUiHost | null, o: UseFirmwareUpdateOptions = {}) {
    const [ui, setUi] = useState<UpdateUi>({ kind: "idle" });
    const storeRef = useRef<FlowStore>(o.store ?? (tabStore ??= sessionFlowStore()));
    const flowRef = useRef<UpdateFlow | null>(null);
    const unsubscribeRef = useRef<(() => void) | null>(null);
    const hostRef = useRef(host);
    hostRef.current = host;
    const lastSource = useRef<{ source: InstallSource; onlyHand?: Hand } | null>(lastSources.get(storeRef.current) ?? null);
    const releases = o.releases ?? CARRIED_RELEASES;

    const attach = useCallback((flow: UpdateFlow) => {
        unsubscribeRef.current?.();
        flowRef.current = flow;
        liveFlows.set(storeRef.current, flow);
        setUi({ kind: "flow", state: flow.state });
        unsubscribeRef.current = flow.subscribe((state) => setUi({ kind: "flow", state }));
    }, []);

    const runFlow = useCallback((flow: UpdateFlow) => {
        attach(flow);
        void flow.run();
    }, [attach]);

    const forget = useCallback(() => {
        unsubscribeRef.current?.();
        unsubscribeRef.current = null;
        flowRef.current?.dismiss();
        if (flowRef.current && liveFlows.get(storeRef.current) === flowRef.current) liveFlows.delete(storeRef.current);
        flowRef.current = null;
    }, []);

    // Remounted mid-update: show the flow that is still running. After a reload: pick the
    // flow back up from sessionStorage.
    useEffect(() => {
        if (!host || flowRef.current) return;
        const live = liveFlows.get(storeRef.current);
        if (live && live.state.phase !== "cancelled" && storeRef.current.load()?.state.id === live.state.id) {
            attach(live);
            return;
        }
        let cancelled = false;
        void UpdateFlow.restore(host, storeRef.current).then((flow) => {
            if (!cancelled && flow && !flowRef.current) runFlow(flow);
        }).catch((error) => console.warn("[firmware] couldn't resume the update", error));
        return () => { cancelled = true; };
    }, [host, attach, runFlow]);

    useEffect(() => () => { unsubscribeRef.current?.(); unsubscribeRef.current = null; }, []);

    const openSheet = useCallback(async (source: InstallSource, onlyHand?: Hand) => {
        const h = hostRef.current;
        if (!h) return;
        lastSource.current = { source, onlyHand };
        lastSources.set(storeRef.current, lastSource.current);
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
                // Gentle: warn, and switch Keep my layout to the default layout (Q8). A blank board stays blank.
                setUi((u) => (u.kind === "sheet" ? { ...u, backup: { state: "failed", error: error instanceof Error ? error.message : String(error) }, afterwards: u.afterwards === "blank" ? "blank" : "defaults" } : u));
            }
        } catch (error) {
            setUi((u) => (u.kind === "sheet" ? { ...u, error: error instanceof Error ? error.message : String(error) } : u));
        }
    }, [releases, o.maxSvalProtocol]);

    const setAfterwards = useCallback((afterwards: Afterwards) => {
        setUi((u) => (u.kind === "sheet" && (afterwards !== "restore" || u.backup.state === "ok") ? { ...u, afterwards } : u));
    }, []);

    const start = useCallback(() => {
        const h = hostRef.current;
        if (!h || ui.kind !== "sheet" || !ui.plan || ui.plan.refusal) return;
        // Keep my layout and the default layout wait for the backup; a blank board needs none.
        if (ui.backup.state === "pending" && ui.afterwards !== "blank") return;
        const backup = ui.backup.state === "ok" ? ui.backup.backup : null;
        runFlow(UpdateFlow.create(h, storeRef.current, { plan: ui.plan, afterwards: ui.afterwards, backup }));
    }, [ui, runFlow]);

    const close = useCallback(() => {
        if (ui.kind === "flow" && ui.state.phase === "running") return; // nothing closes a running update
        forget();
        setUi({ kind: "idle" });
    }, [ui, forget]);

    const retry = useCallback(() => {
        const last = lastSource.current;
        forget();
        if (last) void openSheet(last.source, last.onlyHand);
        else setUi({ kind: "idle" });
    }, [openSheet, forget]);

    /** F9: a one-half update of the half that didn't get the new release, with its own sheet and chord. */
    const finish = useCallback(() => {
        const last = lastSource.current;
        if (ui.kind !== "flow" || !last) return;
        const s = ui.state;
        const stale = ([0, 1] as Hand[]).find((h) => !s.committed.includes(h) && s.files[h]) ?? otherHand(s.usbHand);
        forget();
        void openSheet(last.source, stale);
    }, [ui, openSheet, forget]);

    return { ui, openSheet, setAfterwards, start, close, retry, finish, flow: flowRef.current };
}
