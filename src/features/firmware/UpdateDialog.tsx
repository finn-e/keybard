// The update dialog: the sheet turns into the progress view, then the result or a failure.
// Clicking outside never closes it; beforeunload warns while an update runs; a toast asks to
// keep the tab open when it's hidden (F7).

import { Check, CircleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { FlowState } from "@/services/updater/flow";
import { handName, type Hand } from "@/services/updater/protocol";
import { FailureView, type FailureAction } from "./failures";
import { ProgressView, useTicker } from "./ProgressDialog";
import { UpdateSheet } from "./UpdateSheet";
import type { UpdateUi } from "./useFirmwareUpdate";

const HALF = (h: Hand) => (h === 0 ? "Left half" : "Right half");

export function resultTitle(s: FlowState): string {
    if (s.title.startsWith("Update to")) return `Updated to ${s.toTag}`;
    if (s.title.startsWith("Reinstall")) return `Reinstalled ${s.toTag}`;
    if (s.title.startsWith("Install custom")) return "Installed custom firmware";
    return `Installed ${s.toTag}`;
}

/** A1: the result. */
export function ResultView({ state, notesUrl, onDone }: { state: FlowState; notesUrl?: string; onDone: () => void }) {
    const r = state.result!;
    return (
        <div className="flex flex-col gap-3" data-testid="update-result">
            <h2 className="text-lg font-semibold text-kb-ink">{resultTitle(state)}</h2>
            <ul className="flex flex-col gap-1 text-sm">
                {([0, 1] as Hand[]).filter((h) => r.tags[h]).map((h) => (
                    <li key={h} className="flex items-center gap-2"><Check className="h-4 w-4 text-kb-green" aria-hidden />{HALF(h)} <span className="font-mono">{r.tags[h]}</span></li>
                ))}
            </ul>
            <div className="flex flex-col gap-1 text-sm">
                <p className="flex flex-wrap items-center gap-2">
                    <Check className="h-4 w-4 text-kb-green" aria-hidden />
                    {r.layout === "restored" ? "Layout put back" : "Started from defaults"}
                    {state.backup && <span className="font-mono text-xs text-muted-foreground">{state.backup.fileName}</span>}
                </p>
                {r.trimmed.map((line) => (
                    <p key={line} className="flex items-center gap-2 text-kb-orange"><CircleAlert className="h-4 w-4" aria-hidden />{line}</p>
                ))}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
                {notesUrl ? <a className="text-sm text-kb-primary underline" href={notesUrl} target="_blank" rel="noreferrer">What's new in {state.toTag}</a> : <span />}
                <Button variant="kb-primary" onClick={onDone}>Done</Button>
            </div>
        </div>
    );
}

export interface UpdateDialogProps {
    ui: UpdateUi;
    now: () => number;
    chordLegends: (hand: Hand) => [string, string];
    cancellable: boolean;
    notesUrl?: string;
    udevCommand?: string;
    onAfterwards: (a: "restore" | "defaults") => void;
    onStart: () => void;
    onCancel: () => void;
    onClose: () => void;
    onFailureAction: (a: FailureAction) => void;
    onOpenBackups?: () => void;
    onSaveManually?: () => void;
}

function useHiddenToast(active: boolean) {
    const [hidden, setHidden] = useState(false);
    useEffect(() => {
        if (!active) return;
        const onChange = () => { if (document.visibilityState === "hidden") setHidden(true); };
        document.addEventListener("visibilitychange", onChange);
        return () => document.removeEventListener("visibilitychange", onChange);
    }, [active]);
    return [hidden && active, () => setHidden(false)] as const;
}

export function UpdateDialog(p: UpdateDialogProps) {
    const { ui } = p;
    const running = ui.kind === "flow" && ui.state.phase === "running";
    const now = useTicker(p.now);
    const [toast, dismissToast] = useHiddenToast(running);

    useEffect(() => {
        if (!running) return;
        const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
        window.addEventListener("beforeunload", warn);
        return () => window.removeEventListener("beforeunload", warn);
    }, [running]);

    const onOpenChange = useCallback((open: boolean) => {
        if (open || running) return;
        if (ui.kind === "sheet") p.onCancel();
        else p.onClose();
    }, [running, ui.kind, p]);

    if (ui.kind === "idle" || (ui.kind === "flow" && ui.state.phase === "cancelled")) return null;
    const label = ui.kind === "sheet" ? ui.plan?.title ?? "Firmware update" : ui.state.title;
    const usb = ui.kind === "flow" ? ui.state.usbHand : ((ui.plan?.board.usb.hand ?? 1) as Hand);
    return (
        <Dialog open onOpenChange={onOpenChange}>
            <DialogContent
                showCloseButton={false}
                className="sm:max-w-[520px]"
                onInteractOutside={(e) => e.preventDefault()}
                onEscapeKeyDown={(e) => { if (running) e.preventDefault(); }}
            >
                <DialogTitle className="sr-only">{label}</DialogTitle>
                <DialogDescription className="sr-only">Firmware update for the {handName(usb)} half with USB and its other half</DialogDescription>
                {ui.kind === "sheet" && (
                    ui.preFailure ? (
                        <FailureView failure={{ id: ui.preFailure.id === "unsupported" ? "F18" : ui.preFailure.id }} onAction={p.onFailureAction} />
                    ) : (
                        <UpdateSheet ui={ui} chordLegends={p.chordLegends} onAfterwards={p.onAfterwards} onStart={p.onStart} onCancel={p.onCancel} onOpenBackups={p.onOpenBackups} onSaveManually={p.onSaveManually} />
                    )
                )}
                {ui.kind === "flow" && ui.state.phase === "running" && (
                    <>
                        <ProgressView state={ui.state} legends={p.chordLegends(ui.state.usbHand)} now={now} />
                        {p.cancellable && <div className="flex justify-end"><Button variant="outline" onClick={p.onCancel}>Cancel</Button></div>}
                    </>
                )}
                {ui.kind === "flow" && ui.state.phase === "result" && <ResultView state={ui.state} notesUrl={p.notesUrl} onDone={p.onClose} />}
                {ui.kind === "flow" && ui.state.phase === "failed" && ui.state.failure && (
                    <FailureView failure={ui.state.failure} fromTag={ui.state.fromTag} udevCommand={p.udevCommand} onAction={p.onFailureAction} />
                )}
                {toast && (
                    <div role="status" className="rounded-md border border-kb-gray-border bg-kb-surface p-2 text-sm">
                        Keep this tab open until the update finishes
                        <button type="button" className="ml-2 text-kb-primary underline" onClick={dismissToast}>OK</button>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
