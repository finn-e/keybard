// M: the guided manual install. The first move off firmware without the one-chord updater,
// and every recovery of a half stuck in BOOTSEL. Backup first, the layout choice up front, put back at the end.

import { Check, Download } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { carriedFileUrl, type FirmwareReleasePin } from "@/constants/firmware-releases";
import { SVALBOARD_FIRMWARE_URL } from "@/constants/firmware";
import { PARANOID } from "@/lib/paranoid";
import type { Afterwards } from "@/services/updater/flow";
import { handName, type Hand } from "@/services/updater/protocol";
import { LayoutChoice } from "./LayoutChoice";
import type { BackupStatus } from "./useFirmwareUpdate";

export interface ManualInstallProps {
    release: FirmwareReleasePin | null;
    /** Recovery of one half (F10, F11): only its steps. */
    only?: Hand;
    /** The half the user usually plugs in; the other goes first (U-Q5). */
    usualHand?: Hand;
    backup: BackupStatus | null;
    afterwards: Afterwards;
    onAfterwards: (a: Afterwards) => void;
    onConnect: () => void;
    connected: boolean;
    onClose: () => void;
}

const HALF = (h: Hand) => (h === 0 ? "left" : "right");

function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children?: React.ReactNode }) {
    return (
        <li className="flex gap-3" data-step={n}>
            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${done ? "bg-kb-green text-white" : "border border-kb-gray-border"}`}>{done ? <Check className="h-3.5 w-3.5" aria-hidden /> : n}</span>
            <div className="flex min-w-0 flex-col gap-1">
                <span className="text-sm font-semibold">{title}</span>
                {children}
            </div>
        </li>
    );
}

export function ManualInstall({ release, only, usualHand = 1, backup, afterwards, onAfterwards, onConnect, connected, onClose }: ManualInstallProps) {
    const [downloaded, setDownloaded] = useState<Partial<Record<Hand, boolean>>>({});
    const [installed, setInstalled] = useState<Partial<Record<Hand, boolean>>>({});
    const first = (usualHand === 0 ? 1 : 0) as Hand;
    const halves: Hand[] = only !== undefined ? [only] : [first, usualHand];
    const tag = release?.tag ?? "the latest firmware";
    const fileFor = (h: Hand) => (release ? (h === 0 ? release.files.left.uf2 : release.files.right.uf2) : null);
    let n = 1;
    return (
        <div className="flex flex-col gap-4" data-testid="manual-install">
            <header>
                <h2 className="text-lg font-semibold text-kb-ink">{only !== undefined ? `Install ${tag} on the ${HALF(only)} half` : `Install ${tag} by hand`}</h2>
                {only === undefined && <p className="text-sm text-muted-foreground">Once per keyboard. Later updates come from Keybard.</p>}
            </header>
            {/* No blank board here: a wipe needs the in-app updater (SETTINGS_RESET), which a manual install can't ask. */}
            <LayoutChoice value={afterwards} onChange={onAfterwards} keepDisabled={backup?.state !== "ok"} choices={["restore", "defaults"]} />
            <ol className="flex flex-col gap-3">
                <Step n={n++} title={backup?.state === "failed" ? "Layout not saved" : "Layout saved"} done={backup?.state === "ok"}>
                    {backup?.state === "ok" && <span className="text-sm"><span className="font-mono text-xs">{backup.fileName}</span> · Downloads</span>}
                    {backup?.state === "pending" && <span className="text-sm text-muted-foreground">Saving…</span>}
                    {!backup && <span className="text-sm text-muted-foreground">Connect your keyboard to save its layout first.</span>}
                </Step>
                <Step n={n++} title="Download firmware" done={halves.every((h) => downloaded[h])}>
                    <div className="flex flex-wrap gap-2">
                        {!release ? (
                            PARANOID
                                ? <code className="select-all break-all font-mono text-xs">{SVALBOARD_FIRMWARE_URL}</code>
                                : <a className="text-sm text-kb-primary underline" href={SVALBOARD_FIRMWARE_URL} target="_blank" rel="noreferrer" onClick={() => setDownloaded({ 0: true, 1: true })}>Svalboard firmware release</a>
                        ) : halves.map((h) => {
                            const file = fileFor(h)!;
                            return (
                                <Button key={h} asChild size="sm" variant="outline" onClick={() => setDownloaded((d) => ({ ...d, [h]: true }))}>
                                    <a href={carriedFileUrl(release, file)} download={file}><Download className="h-4 w-4" aria-hidden />{h === 0 ? "Left" : "Right"} half .uf2</a>
                                </Button>
                            );
                        })}
                    </div>
                </Step>
                {halves.map((h) => (
                    <Step key={h} n={n++} title={`Install on the ${HALF(h)} half`} done={installed[h]}>
                        <ul className="text-sm">
                            <li>Plug USB into the {HALF(h)} half</li>
                            <li>Double-tap its reset button</li>
                            <li>Copy the {HALF(h)} file onto the RPI-RP2 drive</li>
                        </ul>
                        {!installed[h] && <Button size="sm" variant="outline" className="self-start" onClick={() => setInstalled((i) => ({ ...i, [h]: true }))}>Next</Button>}
                    </Step>
                ))}
                <Step n={n++} title="Connect your keyboard" done={connected}>
                    <span className="text-sm">Plug USB back into your usual half{only === undefined ? "" : ` (the ${handName(usualHand)} half)`}</span>
                    {!connected && <Button size="sm" variant="kb-primary" className="self-start" onClick={onConnect}>Connect</Button>}
                </Step>
            </ol>
            <div className="flex justify-end"><Button variant="outline" onClick={onClose}>{connected ? "Done" : "Close"}</Button></div>
        </div>
    );
}
