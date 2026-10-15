// B1: the one confirm. Checks, backup, warnings, Afterwards, what to do on the keyboard.

import { Check, CircleAlert, Loader2, XCircle } from "lucide-react";
import { useId } from "react";

import { Button } from "@/components/ui/button";
import type { CheckRow } from "@/services/updater/checks";
import { handName, otherHand, type Hand } from "@/services/updater/protocol";
import { ChordDiagram } from "./ChordDiagram";
import type { UpdateUi } from "./useFirmwareUpdate";

type SheetUi = Extract<UpdateUi, { kind: "sheet" }>;

const HALF = (h: Hand) => (h === 0 ? "Left half" : "Right half");

function Row({ row }: { row: CheckRow }) {
    const icon = row.state === "ok" ? <Check className="h-4 w-4 text-kb-green" aria-hidden />
        : row.state === "pending" ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
            : row.state === "refuse" ? <XCircle className="h-4 w-4 text-kb-red" aria-hidden />
                : <CircleAlert className="h-4 w-4 text-kb-orange" aria-hidden />;
    const tone = row.state === "warn" ? "text-kb-orange" : row.state === "refuse" ? "text-kb-red" : "text-kb-ink";
    return (
        <li className="flex items-start gap-2" data-check={row.id} data-state={row.state}>
            <span className="mt-0.5">{icon}</span>
            <span className="flex flex-col">
                <span className={`text-sm font-medium ${tone}`}>{row.label}</span>
                {row.detail && <span className="text-xs text-muted-foreground">{row.detail}</span>}
            </span>
        </li>
    );
}

export interface UpdateSheetProps {
    ui: SheetUi;
    chordLegends: (hand: Hand) => [string, string];
    onAfterwards: (a: "restore" | "defaults") => void;
    onStart: () => void;
    onCancel: () => void;
    onOpenBackups?: () => void;
    onSaveManually?: () => void;
}

export function UpdateSheet({ ui, chordLegends, onAfterwards, onStart, onCancel, onOpenBackups, onSaveManually }: UpdateSheetProps) {
    const { plan, backup, afterwards } = ui;
    const group = useId();
    if (ui.error) {
        return (
            <div className="flex flex-col gap-3">
                <h2 className="text-lg font-semibold">Can't update right now</h2>
                <p role="alert" className="text-sm">{ui.error}</p>
                <div className="flex justify-end"><Button variant="outline" onClick={onCancel}>Close</Button></div>
            </div>
        );
    }
    if (!plan) {
        return (
            <div className="flex flex-col gap-3" aria-busy="true">
                <h2 className="text-lg font-semibold">Checking your keyboard</h2>
                <ul className="flex flex-col gap-2">
                    <Row row={{ id: "connected", label: "Both halves connected", state: "pending" }} />
                    <Row row={{ id: "files", label: "Firmware files verified", state: "pending" }} />
                    <Row row={{ id: "backup", label: "Layout saved", state: "pending" }} />
                </ul>
                <div className="flex justify-end"><Button variant="outline" onClick={onCancel}>Cancel</Button></div>
            </div>
        );
    }
    const usb = plan.board.usb.hand as Hand;
    const halves = plan.target === "both" ? "Left and right halves" : `${HALF(plan.target)} only`;
    const refusal = plan.refusal;
    const backupFailed = backup.state === "failed";
    const checks = plan.checks.filter((c) => c.state !== "warn");
    const warnings = backupFailed ? [...plan.warnings, { id: "backup-failed", label: "Layout not saved", state: "warn" as const, detail: "Afterwards switched to Start from defaults." }] : plan.warnings;
    const anyWarning = warnings.length > 0;
    const onlyUsb = plan.otherSilent && plan.target === usb;
    const primary = onlyUsb ? `Update ${handName(usb)} half only` : anyWarning ? "Update anyway" : "Start update";
    const ready = !refusal && backup.state !== "pending";
    const legends = chordLegends(usb);
    return (
        <div className="flex flex-col gap-4" data-testid="update-sheet">
            <header>
                <h2 className="text-lg font-semibold text-kb-ink">{plan.title}</h2>
                <p className="text-sm text-muted-foreground">{halves} · About {plan.target === "both" ? "2 minutes" : "1 minute"}</p>
            </header>

            <section aria-label="Checks">
                <ul className="flex flex-col gap-2">
                    {checks.map((c) => <Row key={c.id} row={c} />)}
                    {refusal && !checks.some((c) => c.id === refusal.id) && <Row row={refusal} />}
                    {warnings.map((w) => <Row key={`w-${w.id}`} row={w} />)}
                </ul>
            </section>

            {!refusal && (
                <>
                    <section aria-label="Backup" className="flex flex-col gap-1">
                        {backup.state === "pending" && <Row row={{ id: "backup", label: "Saving your layout", state: "pending" }} />}
                        {backup.state === "ok" && (
                            <div className="flex flex-wrap items-center gap-x-2 text-sm">
                                <Check className="h-4 w-4 text-kb-green" aria-hidden />
                                <span className="font-medium">Layout saved</span>
                                <span className="font-mono text-xs">{backup.fileName}</span>
                                <span className="text-muted-foreground">· Downloads</span>
                                {onOpenBackups && <button type="button" className="text-kb-primary underline" onClick={onOpenBackups}>Backups</button>}
                            </div>
                        )}
                        {backupFailed && onSaveManually && <button type="button" className="self-start text-sm text-kb-primary underline" onClick={onSaveManually}>Save layout manually</button>}
                    </section>

                    <fieldset className="flex flex-col gap-1" aria-label="Afterwards">
                        <legend className="mb-1 text-sm font-semibold">Afterwards</legend>
                        <label className="flex items-center gap-2 text-sm">
                            <input type="radio" name={group} checked={afterwards === "restore"} disabled={backup.state !== "ok"} onChange={() => onAfterwards("restore")} />
                            Put my layout back{backupFailed && <span className="text-muted-foreground"> · No backup</span>}
                        </label>
                        <label className="flex items-center gap-2 text-sm">
                            <input type="radio" name={group} checked={afterwards === "defaults"} onChange={() => onAfterwards("defaults")} />
                            Start from the {plan.toTag} defaults
                        </label>
                    </fieldset>

                    <section aria-label="On the keyboard" className="flex flex-col gap-2 rounded-md border border-kb-gray-border p-3">
                        {plan.board.noChord ? (
                            <p className="text-sm font-medium text-kb-orange">Nothing to press: this developer build installs without approval</p>
                        ) : (
                            <>
                                <ChordDiagram hand={usb} legends={legends} />
                                <p className="text-sm font-medium">Hold {legends[0]} + {legends[1]} once, when the light blinks blue</p>
                                {plan.target === "both" && <p className="text-xs text-muted-foreground">One hold approves both halves</p>}
                            </>
                        )}
                        <p className="text-xs text-muted-foreground">Keep USB and the split cable connected.</p>
                        {plan.target === otherHand(usb) && <p className="text-xs text-muted-foreground">Don't type on the {handName(plan.target)} half while it copies.</p>}
                    </section>
                </>
            )}

            <footer className="flex flex-wrap justify-end gap-2">
                {refusal?.id === "integrity" ? (
                    <>
                        <Button variant="outline" onClick={() => window.location.reload()}>Reload</Button>
                        <Button variant="outline" onClick={onCancel}>Close</Button>
                    </>
                ) : (
                    <>
                        <Button variant="outline" onClick={onCancel}>Cancel</Button>
                        {!refusal && <Button variant="kb-primary" disabled={!ready} onClick={onStart}>{primary}</Button>}
                    </>
                )}
            </footer>
        </div>
    );
}
