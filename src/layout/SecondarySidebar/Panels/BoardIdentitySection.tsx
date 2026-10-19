import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useKeyboard } from "@/contexts/KeyboardContext";
import { identityService, IdentityInfo, IdentityStatus, NAME_MAX_CHARS, nameLength, nameProblem, SerialSource } from "@/services/identity.service";
import { useEffect, useState } from "react";

const STATUS_TEXT: Record<number, string> = {
    [IdentityStatus.Invalid]: "The keyboard didn't accept that name.",
    [IdentityStatus.Unavailable]: "This keyboard has nowhere to keep a name.",
    [IdentityStatus.WriteFailed]: "The keyboard couldn't save the name. Try again.",
};

/**
 * The board's own name and serial, kept on the keyboard so they survive
 * firmware updates. Shown only when the firmware supports it.
 */
export default function BoardIdentitySection() {
    const { isConnected, connectionSessionId, hasUnsavedChanges, runDeviceMaintenance } = useKeyboard();
    const [info, setInfo] = useState<IdentityInfo | null>(null);
    const [draft, setDraft] = useState("");
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [needsRestart, setNeedsRestart] = useState(false);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        let cancelled = false;
        setInfo(null);
        setBusy(false);
        setMessage(null);
        setNeedsRestart(false);
        if (!isConnected) return;
        identityService.getInfo().then((i) => {
            if (cancelled) return;
            setInfo(i);
            setDraft(i?.name ?? "");
        }).catch(() => {
            if (!cancelled) setInfo(null);
        });
        return () => {
            cancelled = true;
        };
    }, [isConnected, connectionSessionId]);

    if (!info) return null;

    const dirty = draft !== info.name;
    const problem = nameProblem(draft, info.nameMaxBytes);

    const save = async () => {
        if (!window.confirm("Save this board name to the keyboard now? This maintenance action takes effect immediately, including in Manual Updates mode.")) return;
        setBusy(true);
        setMessage(null);
        try {
            const status = await runDeviceMaintenance(() => identityService.setName(draft));
            if (status === IdentityStatus.Ok) {
                setInfo({ ...info, name: draft });
                setNeedsRestart(true);
            } else {
                setMessage(STATUS_TEXT[status] ?? "The keyboard didn't accept that name.");
            }
        } catch {
            setMessage("Couldn't save the name. Check the keyboard connection and try again.");
        } finally {
            setBusy(false);
        }
    };

    const copySerial = async () => {
        try {
            await navigator.clipboard.writeText(info.serial);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
        } catch {
            setMessage("Couldn't copy the serial. Select it and copy it instead.");
        }
    };

    const restart = async () => {
        if (!window.confirm(hasUnsavedChanges
            ? "There are unsaved layout edits. Restarting disconnects the keyboard; export a backup or apply those edits first. Restart anyway?"
            : "Restart the keyboard now? It will disconnect temporarily.")) return;
        setBusy(true);
        setMessage(null);
        try {
            await runDeviceMaintenance(() => identityService.restart());
            setNeedsRestart(false);
        } catch {
            setMessage("Couldn't confirm the restart. Reconnect the keyboard if needed.");
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="flex flex-col p-3 gap-3 panel-layer-item" data-testid="board-identity">
            <div className="flex flex-col gap-1">
                <span className="text-md text-left">Board name</span>
                <span className="text-xs text-muted-foreground">
                    Shown by your computer and browser. Kept on the keyboard across firmware updates. Save writes immediately, independently of layout Apply.
                </span>
            </div>
            {info.available ? (
                <>
                    <div className="flex flex-row items-center gap-2">
                        <Input
                            aria-label="Board name"
                            disabled={busy}
                            value={draft}
                            placeholder="Svalboard"
                            onChange={(e) => {
                                setDraft(e.target.value);
                                setMessage(null);
                            }}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && dirty && !problem && !busy) save();
                            }}
                            className={dirty ? "border-amber-500" : undefined}
                        />
                        <Button size="sm" disabled={!dirty || !!problem || busy} onClick={save}>
                            Save now
                        </Button>
                    </div>
                    <div className="flex flex-row justify-between text-xs text-muted-foreground">
                        <span role={problem || message ? "alert" : "status"} className={problem ? "text-red-600 dark:text-red-400" : undefined}>{problem ?? message ?? (dirty ? "Not saved yet" : "")}</span>
                        <span>
                            {nameLength(draft)}/{NAME_MAX_CHARS}
                        </span>
                    </div>
                    {needsRestart && (
                        <span role="status" className="text-xs">Saved. Restart the keyboard for your computer to show the new name.</span>
                    )}
                </>
            ) : (
                <span className="text-xs text-muted-foreground">This keyboard's flash has no room for a name.</span>
            )}
            <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                <div className="flex flex-row flex-wrap items-center gap-2">
                    <span>
                        Serial <span className="font-mono">{info.serial}</span>
                    </span>
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={copySerial} aria-label="Copy serial">
                        {copied ? "Copied" : "Copy"}
                    </Button>
                </div>
                {info.serialSource === SerialSource.Random && <span>Generated on this keyboard (its flash chip has no ID).</span>}
            </div>
            <div className="flex flex-row items-center justify-between gap-2 border-t border-kb-gray-border pt-3">
                <span className="text-xs text-muted-foreground">Disconnects the keyboard for a few seconds.</span>
                <Button size="sm" variant={needsRestart ? "default" : "outline"} disabled={busy} onClick={restart}>
                    Restart keyboard
                </Button>
            </div>
        </div>
    );
}
