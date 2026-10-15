// D2: the Firmware page. "This keyboard", the install list (carried releases and
// Choose a file…), highlights, one primary button, Advanced. Every button opens the sheet.

import { ChevronRight } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import type { FirmwareReleasePin } from "@/constants/firmware-releases";
import { PARANOID } from "@/lib/paranoid";
import { loadSvup, SvupError, type SvupFile } from "@/services/updater/svup";
import type { Hand } from "@/services/updater/protocol";
import type { BoardSummary } from "./board-summary";

export type FirmwarePick = { kind: "release"; release: FirmwareReleasePin } | { kind: "files"; files: SvupFile[] };

export interface FirmwareSectionProps {
    /** Null: no keyboard connected (D2e). */
    board: BoardSummary | null;
    releases: FirmwareReleasePin[];
    onInstall: (pick: FirmwarePick, onlyHand?: Hand) => void;
    onManual: (release: FirmwareReleasePin | null) => void;
    onConnect?: () => void;
    paranoid?: boolean;
    /** Its own "Firmware" title; off inside Settings, whose section is titled already. */
    heading?: boolean;
}

const HALF = (h: Hand) => (h === 0 ? "Left half" : "Right half");
const FILE_ROW = "__file__";

function buttonLabel(pick: FirmwareReleasePin | null, board: BoardSummary | null, newest: FirmwareReleasePin | null): string {
    if (!pick) return "Install file";
    if (board?.updater && board.differ) return "Finish update";
    if (board?.updater && board.fwVersion === pick.fwVersion && board.tag === pick.tag) return `Reinstall ${pick.tag}`;
    if (board?.updater && pick.fwVersion > board.fwVersion && pick === newest) return `Update to ${pick.tag}`;
    return `Install ${pick.tag}`;
}

export function FirmwareSection({ board, releases, onInstall, onManual, onConnect, paranoid = PARANOID, heading = true }: FirmwareSectionProps) {
    const newest = releases[0] ?? null;
    const installedTag = board?.updater ? board.tag : null;
    const initial = useMemo(() => {
        if (paranoid || !releases.length) return FILE_ROW;
        return (board?.differ && releases.find((r) => r.tag === installedTag)?.tag) || newest!.tag;
    }, [paranoid, releases, board?.differ, installedTag, newest]);
    const [selected, setSelected] = useState<string>(initial);
    const [advanced, setAdvanced] = useState(false);
    const [fileError, setFileError] = useState<string | null>(null);
    const [pendingHand, setPendingHand] = useState<Hand | undefined>(undefined);
    const fileInput = useRef<HTMLInputElement>(null);
    const group = useId();
    const pick = releases.find((r) => r.tag === selected) ?? null;
    const boardNewer = !!(board?.updater && newest && board.fwVersion > newest.fwVersion);

    const chooseFiles = (onlyHand?: Hand) => {
        setPendingHand(onlyHand);
        setFileError(null);
        fileInput.current?.click();
    };
    const onFiles = async (list: FileList | null) => {
        if (!list?.length) return;
        try {
            const files = await Promise.all([...list].slice(0, 2).map(async (f) => loadSvup(new Uint8Array(await f.arrayBuffer()))));
            onInstall({ kind: "files", files }, pendingHand);
        } catch (error) {
            setFileError(error instanceof SvupError ? error.message : "Keybard couldn't read that file.");
        } finally {
            if (fileInput.current) fileInput.current.value = "";
        }
    };
    const primary = () => {
        if (!board) return onConnect?.();
        if (!board.updater) return onManual(pick ?? newest);
        if (!pick) return chooseFiles();
        onInstall({ kind: "release", release: pick });
    };

    let label = buttonLabel(pick, board, newest);
    if (!board) label = "Connect";
    else if (!board.updater) label = `Install ${(pick ?? newest)?.tag ?? "by hand"}`;
    const status = !board ? null : board.updater && board.differ ? "Halves differ" : board.updater && newest && board.halves.every((h) => h.fwVersion >= newest.fwVersion) ? "Up to date" : null;

    return (
        <section aria-labelledby={heading ? "fw-title" : undefined} aria-label={heading ? undefined : "Firmware"} className="flex flex-col gap-4" data-testid="firmware-section">
            {heading && <h2 id="fw-title" className="text-lg font-semibold text-kb-ink">Firmware</h2>}

            <div className="flex flex-col gap-1" aria-label="This keyboard">
                <h3 className={`text-sm font-semibold ${status === "Halves differ" ? "text-kb-orange" : "text-muted-foreground"}`}>{status ?? "This keyboard"}</h3>
                {!board && <p className="text-sm">Connect a keyboard to see its firmware.</p>}
                {board && !board.updater && <p className="text-sm"><span className="font-mono">{board.legacyLabel ?? "Older firmware"}</span></p>}
                {board?.updater && board.halves.map((h) => {
                    const stale = board.differ && newest && h.fwVersion !== Math.max(...board.halves.map((x) => x.fwVersion));
                    return (
                        <p key={h.hand} className={`flex flex-wrap items-center gap-x-2 text-sm ${stale ? "text-kb-orange" : ""}`} data-half={h.hand}>
                            <span className="font-medium">{HALF(h.hand)}</span>
                            {h.answered ? <span className="font-mono">{h.tag}</span> : <span className="text-muted-foreground">not answering</span>}
                            {h.answered && <span className="text-muted-foreground">· {h.pointing}</span>}
                            {h.usb && <span className="rounded border border-kb-gray-border px-1 text-[10px] uppercase text-muted-foreground">USB</span>}
                        </p>
                    );
                })}
                {boardNewer && <p className="text-sm text-muted-foreground">Newer than this Keybard</p>}
            </div>

            <div className="flex flex-col gap-1" role="radiogroup" aria-label="Install">
                <h3 className="text-sm font-semibold text-muted-foreground">Install</h3>
                {!paranoid && releases.map((r, i) => {
                    const installed = installedTag === r.tag && board?.fwVersion === r.fwVersion;
                    return (
                        <label key={r.tag} className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${selected === r.tag ? "border-kb-primary" : "border-kb-gray-border"}`}>
                            <input type="radio" name={group} checked={selected === r.tag} onChange={() => setSelected(r.tag)} />
                            <span className="font-mono font-medium">{r.tag}</span>
                            <span className="text-muted-foreground">{installed ? "Installed" : i === 0 ? "Newest" : "Older"}{r.kind === "x" ? " · Prerelease" : ""}</span>
                            {board && !board.updater && i === 0 && <span className="text-muted-foreground">· One manual install, then updates come from Keybard</span>}
                            {r.notesUrl && <a className="ml-auto text-kb-primary underline" href={r.notesUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>What's new</a>}
                        </label>
                    );
                })}
                <label className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${selected === FILE_ROW ? "border-kb-primary" : "border-kb-gray-border"}`}>
                    <input type="radio" name={group} checked={selected === FILE_ROW} onChange={() => setSelected(FILE_ROW)} />
                    <span className="font-medium">Choose a file…</span>
                </label>
                <input ref={fileInput} type="file" accept=".svup" multiple hidden data-testid="svup-input" onChange={(e) => void onFiles(e.target.files)} />
                {fileError && <p role="alert" className="text-sm text-kb-red">{fileError}</p>}
            </div>

            {pick && pick.highlights.length > 0 && (
                <ul className="list-disc pl-5 text-sm">{pick.highlights.slice(0, 3).map((h) => <li key={h}>{h}</li>)}</ul>
            )}

            <div className="flex flex-wrap items-center gap-2">
                <Button variant="kb-primary" onClick={primary}>{label}</Button>
                {boardNewer && !paranoid && <Button variant="outline" onClick={() => window.location.reload()}>Reload</Button>}
            </div>

            {board?.updater && (
                <div>
                    <button type="button" className="flex items-center gap-1 text-sm text-muted-foreground" aria-expanded={advanced} onClick={() => setAdvanced((a) => !a)}>
                        <ChevronRight className={`h-4 w-4 transition-transform ${advanced ? "rotate-90" : ""}`} aria-hidden /> Advanced
                    </button>
                    {advanced && (
                        <div className="mt-2 flex flex-wrap gap-2">
                            {([0, 1] as Hand[]).map((h) => (
                                <Button key={h} size="sm" variant="outline" onClick={() => (pick ? onInstall({ kind: "release", release: pick }, h) : chooseFiles(h))}>
                                    Update {h === 0 ? "left" : "right"} half…
                                </Button>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </section>
    );
}
