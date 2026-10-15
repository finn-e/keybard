// The progress view (update-flow 5): two rows with a light swatch each, the one approval,
// the restart. No buttons until the result, except Cancel before the first install.

import { useEffect, useState } from "react";

import type { FlowState, RowState } from "@/services/updater/flow";
import { handName, otherHand, type Hand } from "@/services/updater/protocol";
import { ChordDiagram } from "./ChordDiagram";
import { LightSwatch } from "./LightSwatch";
import { lightFor, stageLabel } from "./lights";

const HALF = (h: Hand) => (h === 0 ? "Left half" : "Right half");

const INSTALL_STEPS = new Set(["other-install", "self-install"]);

/** The dialog's title follows the step that matters (5.1). */
export function progressTitle(s: FlowState, legends: [string, string]): string {
    if (s.step === "approve") return `Hold ${legends[0]} + ${legends[1]} on the ${handName(s.usbHand)} half`;
    if (INSTALL_STEPS.has(s.step)) return "Installing · don't unplug";
    return "Updating keyboard";
}

const REMAINING_S: Partial<Record<FlowState["step"], number>> = {
    start: 110, approve: 100, "other-erase": 95, "other-send": 85, "other-verify": 78, relay: 70, "other-install": 55,
    "other-restart": 50, "self-arm": 45, "self-erase": 44, "self-send": 38, "self-verify": 30, "self-install": 28,
    reconnect: 25, "check-halves": 15, "settings-reset": 15, restore: 10,
};

/** One footer line at a time. */
export function progressFooter(s: FlowState, now: number): string {
    const o = otherHand(s.usbHand);
    if (s.step === "relay") return `Don't type on the ${handName(o)} half`;
    if (lightFor(s, s.usbHand, now) === "red-slow") return "Red until this half updates";
    const left = REMAINING_S[s.step];
    if (left === undefined) return "";
    const share = s.target === "both" ? 1 : 0.55;
    const secs = Math.max(5, Math.round(left * share - (now - s.stepAt) / 1000));
    return secs >= 60 ? `About ${Math.round(secs / 60)} min left` : "Less than a minute left";
}

function Bar({ row }: { row: RowState }) {
    const magenta = row.stage === "installing";
    if (row.progress === null) {
        return <div className={`h-1.5 w-full overflow-hidden rounded-full bg-kb-gray-medium ${magenta ? "" : "fw-indeterminate"}`} style={magenta ? { background: "var(--color-kb-magenta)" } : undefined} />;
    }
    return (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-kb-gray-medium" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(row.progress * 100)}>
            <div className="h-full rounded-full bg-kb-primary transition-[width]" style={{ width: `${Math.round(row.progress * 100)}%` }} />
        </div>
    );
}

export function useTicker(now: () => number, ms = 250): number {
    const [t, setT] = useState(now);
    useEffect(() => {
        const id = setInterval(() => setT(now()), ms);
        return () => clearInterval(id);
    }, [now, ms]);
    return t;
}

export function ProgressView({ state, legends, now }: { state: FlowState; legends: [string, string]; now: number }) {
    const o = otherHand(state.usbHand);
    const rows = [...state.rows].sort((a, b) => (a.usb === b.usb ? 0 : a.usb ? 1 : -1));
    const approving = state.step === "approve";
    const countdown = approving && state.approveAt !== null ? Math.max(0, 30 - Math.floor((now - state.approveAt) / 1000)) : null;
    return (
        <div className="flex flex-col gap-4" data-testid="update-progress" data-step={state.step}>
            <h2 className="text-lg font-semibold text-kb-ink" aria-live="polite">{progressTitle(state, legends)}</h2>
            {approving && (
                <div className="flex flex-col items-start gap-2">
                    <ChordDiagram hand={state.usbHand} legends={legends} />
                    {countdown !== null && <p className="text-sm text-muted-foreground tabular-nums">{countdown} s</p>}
                </div>
            )}
            <ul className="flex flex-col gap-3">
                {rows.map((r) => (
                    <li key={r.hand} className="flex items-center gap-3" data-row={handName(r.hand)} data-stage={r.stage}>
                        <LightSwatch light={lightFor(state, r.hand, now)} />
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                            <div className="flex items-baseline justify-between gap-2 text-sm">
                                <span className="font-medium">
                                    {HALF(r.hand)}
                                    {r.usb && <span className="ml-1.5 rounded border border-kb-gray-border px-1 text-[10px] uppercase text-muted-foreground">USB</span>}
                                </span>
                                <span className="truncate text-muted-foreground tabular-nums">{r.stage === "done" ? `${r.toTag} ✓` : stageLabel(r.stage, r.progress, `${handName(o)} half`)}</span>
                            </div>
                            <Bar row={r} />
                        </div>
                    </li>
                ))}
            </ul>
            <p className="min-h-5 text-sm text-muted-foreground">{progressFooter(state, now)}</p>
        </div>
    );
}
