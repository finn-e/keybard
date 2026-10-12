import { useKeyboard } from "@/contexts/KeyboardContext";
import { isKnownKeycodeVersion, LATEST_KEYCODE_VERSION } from "@/constants/keycode-numbering";
import { useEffect, useState } from "react";
import { describeFirmware, firmwareUpdateNotice } from "@/constants/firmware";
import { FirmwareUpdateNote, UnsupportedFirmwareCard } from "@/components/FirmwareUpdate";

/** How long the firmware line shows after connecting. */
export const FIRMWARE_CHIP_MS = 6000;

/** Announce target changes without reserving a row in the editor. */
export default function EditingTargetStatus() {
    const { keyboard, isConnected, loadedFrom, connectionState, connectionError, connectionFirmware, dismissConnectionError, isChangingTarget, connectionSessionId } = useKeyboard();
    const firmware = isConnected && keyboard ? describeFirmware(keyboard) : null;
    // Name the firmware briefly after each connect, then get out of the way.
    const [chipSession, setChipSession] = useState<number | null>(null);
    useEffect(() => {
        if (!firmware) return;
        setChipSession(connectionSessionId ?? 0);
        const timer = setTimeout(() => setChipSession(null), FIRMWARE_CHIP_MS);
        return () => clearTimeout(timer);
    }, [connectionSessionId, firmware]);
    if (!keyboard) return null;
    const unknownKeycodes = isConnected && keyboard.keycode_version && !isKnownKeycodeVersion(keyboard.keycode_version);
    const firmwareNotice = isConnected ? firmwareUpdateNotice(keyboard) : null;
    return (
        <>
            <div role="status" className="sr-only">
                <span className="font-medium break-words [overflow-wrap:anywhere]">
                    {isConnected ? "Editing keyboard" : "Offline draft"}: {loadedFrom || keyboard.name || "Layout"}
                </span>
                {firmware && <span>. Firmware: {firmware}</span>}
                {!isConnected && <span>No keyboard writes. Export to keep edits.</span>}
                {(isChangingTarget || connectionState === "loading") && <span>Changing connection…</span>}
            </div>
            {(unknownKeycodes || firmwareNotice) && (
                <div className="absolute left-4 top-full z-50 flex max-w-sm flex-col gap-2">
                    {unknownKeycodes && (
                        <p role="alert" className="whitespace-normal rounded-md border border-amber-300 dark:border-amber-800 bg-kb-surface p-3 text-sm text-amber-800 dark:text-amber-300 shadow-sm">
                            This keyboard numbers keycodes as QMK {keyboard.keycode_version}; this Keybard knows up to {LATEST_KEYCODE_VERSION}. Keys QMK has renumbered since may show or save as the wrong key. Update Keybard before editing.
                        </p>
                    )}
                    {firmwareNotice && <FirmwareUpdateNote notice={firmwareNotice} />}
                </div>
            )}
            {connectionFirmware
                ? <UnsupportedFirmwareCard info={connectionFirmware} onDismiss={dismissConnectionError} className="absolute right-4 top-full z-50 max-w-sm whitespace-normal shadow-sm" />
                : connectionError
                    ? <p role="alert" className="absolute right-4 top-full z-50 max-w-sm whitespace-normal rounded-md border border-red-200 dark:border-red-900 bg-kb-surface p-3 text-sm text-red-700 dark:text-red-400 shadow-sm">{connectionError}</p>
                    : firmware && chipSession !== null && (
                        <p data-testid="firmware-chip" aria-hidden="true" className="pointer-events-none absolute right-4 top-full z-50 max-w-sm truncate rounded-full border border-kb-gray-border bg-kb-surface px-3 py-1 text-xs text-muted-foreground shadow-sm">
                            Firmware: <span className="font-mono">{firmware}</span>
                        </p>
                    )}
        </>
    );
}
