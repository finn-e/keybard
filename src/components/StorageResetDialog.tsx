import { useEffect, useMemo, useState, type FC } from "react";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { serializeForBackup, useBackups } from "@/contexts/BackupContext";
import { useChanges } from "@/contexts/ChangesContext";
import { useKeyboard } from "@/contexts/KeyboardContext";
import { restoreLayoutToBoard } from "@/features/firmware/restore";
import { fingerprintSvil } from "@/services/backup/codec";
import { getBackupService, type SnapshotMeta } from "@/services/backup/backup.service";
import { keyboardService } from "@/services/keyboard.service";
import { updateInFlight } from "@/services/updater/flow";
import type { KeyboardInfo } from "@/types/keyboard.types";

/** Ask the app to show Backups (Settings wires the listener). */
export const OPEN_BACKUPS_EVENT = "keybard:open-backups";

function describeSnapshot(snap: SnapshotMeta, now = new Date()): string {
    const d = new Date(snap.savedAt);
    const sameDay = d.toDateString() === now.toDateString();
    const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const when = sameDay ? `Today ${time}` : `${d.toLocaleDateString()} ${time}`;
    return [snap.boardName, snap.fromTag, when].filter(Boolean).join(" · ");
}

export interface ResetNoticeViewProps {
    /** A new firmware build reset the settings (bit 2), rather than unreadable storage (bit 0). */
    firmware: boolean;
    /** The newest backup of this board, e.g. "Kip · v3 · Today 10:42"; null when there's none. */
    backupLine: string | null;
    busy?: boolean;
    error?: string | null;
    onDefaults: () => void;
    onOtherBackups: () => void;
    onPutBack: () => void;
}

/** A4 and the bit-0 notice: the title, the newest backup, and Put my layout back. */
export function ResetNoticeView({ firmware, backupLine, busy, error, onDefaults, onOtherBackups, onPutBack }: ResetNoticeViewProps) {
    return (
        <>
            <DialogHeader>
                <DialogTitle>{firmware ? "New firmware reset your settings" : "Your keyboard's settings were reset"}</DialogTitle>
                <DialogDescription>
                    {backupLine ?? (firmware ? "No backup of this keyboard in this browser." : "Your keyboard couldn't read its saved settings, so it started again from its defaults. Load your layout file to restore your setup.")}
                </DialogDescription>
            </DialogHeader>
            {error && <p role="alert" className="text-sm text-kb-red">{error}</p>}
            <DialogFooter className="flex-wrap gap-2">
                {backupLine ? (
                    <>
                        <Button variant="outline" disabled={busy} onClick={onDefaults}>Start from defaults</Button>
                        <Button variant="outline" disabled={busy} onClick={onOtherBackups}>Other backups</Button>
                        <Button variant="kb-primary" disabled={busy} onClick={onPutBack}>{busy ? "Putting it back…" : "Put my layout back"}</Button>
                    </>
                ) : (
                    <Button onClick={onDefaults}>OK</Button>
                )}
            </DialogFooter>
        </>
    );
}

/**
 * Shown once per connection when the board reports a storage problem:
 * - it can't save changes right now, so they'll be lost when it restarts;
 * - new firmware reset its settings (bit 2) with no update in flight (A4): a .uf2
 *   installed by hand, or a tab closed mid-update. The one place a restore is asked afterwards;
 * - it reset its settings because its storage could not be read (bit 0).
 * Both resets offer "Put my layout back" from the newest backup of this board.
 * Acknowledging a reset clears the board's flag (0x2A), after the restore when there is one.
 */
export const StorageResetDialog: FC = () => {
    const { keyboard, isConnected } = useKeyboard();
    const [acknowledgedReset, setAcknowledgedReset] = useState<string | null>(null);
    const [acknowledgedWriteFailure, setAcknowledgedWriteFailure] = useState<string | null>(null);
    const kbid = keyboard?.kbid ?? "";
    const buildReset = !!keyboard?.storage_build_reset && !updateInFlight();
    const showWriteFailure = Boolean(isConnected && keyboard?.storage_write_failed && acknowledgedWriteFailure !== kbid);
    const showReset = Boolean(isConnected && (keyboard?.storage_reset || buildReset) && acknowledgedReset !== kbid && !showWriteFailure);

    // The board clears this itself when it restarts, so there's nothing to send.
    const acknowledgeWriteFailure = () => setAcknowledgedWriteFailure(kbid);

    if (showWriteFailure) {
        return (
            <Dialog open onOpenChange={(next) => !next && acknowledgeWriteFailure()}>
                <DialogContent className="sm:max-w-[480px]">
                    <DialogHeader>
                        <DialogTitle>Your keyboard can't save changes</DialogTitle>
                        <DialogDescription>
                            Your keyboard couldn't save its settings since it was plugged in. Changes you make will
                            show up, but they'll be lost when it restarts. Unplug it and plug it back in, then make
                            your changes again.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button onClick={acknowledgeWriteFailure}>OK</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        );
    }
    if (!showReset || !keyboard) return null;
    return <ResetDialog keyboard={keyboard} firmware={buildReset && !keyboard.storage_reset} onAcknowledged={() => setAcknowledgedReset(kbid)} />;
};

/** The reset notice, with the newest backup of this board to put back. */
function ResetDialog({ keyboard, firmware, onAcknowledged }: { keyboard: KeyboardInfo; firmware: boolean; onAcknowledged: () => void }) {
    const { setKeyboard } = useKeyboard();
    const { queue, commit } = useChanges();
    const { snapshots, board } = useBackups();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [currentFingerprint, setCurrentFingerprint] = useState<string | null>(null);

    // The "connected" snapshot taken just now holds the defaults: leave it out.
    useEffect(() => {
        let cancelled = false;
        void fingerprintSvil(serializeForBackup(keyboard)).then((f) => { if (!cancelled) setCurrentFingerprint(f); }).catch(() => undefined);
        return () => { cancelled = true; };
    }, [keyboard]);
    const newest = useMemo(() => {
        if (!board) return null;
        return snapshots.filter((s) => s.boardKey === board.key && s.fingerprint !== currentFingerprint).sort((a, b) => b.savedAt - a.savedAt)[0] ?? null;
    }, [snapshots, board, currentFingerprint]);

    const acknowledgeReset = async () => {
        onAcknowledged();
        try {
            await keyboardService.clearStorageReset();
        } catch (error) {
            // The board keeps reporting the reset, so the next connection asks again.
            console.warn("Could not clear the storage reset notice", error);
        }
    };

    const putBack = async () => {
        if (!newest) return;
        setBusy(true);
        setError(null);
        try {
            const service = getBackupService();
            if (!service) throw new Error("Backups are unavailable in this browser.");
            const svil = await service.getSvil(newest.id);
            await restoreLayoutToBoard(svil, { keyboard, setKeyboard, queue, commit });
            await acknowledgeReset();
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    };

    const otherBackups = () => {
        onAcknowledged();
        window.dispatchEvent(new CustomEvent(OPEN_BACKUPS_EVENT));
    };

    return (
        <Dialog open onOpenChange={(next) => !next && !busy && acknowledgeReset()}>
            <DialogContent className="sm:max-w-[480px]">
                <ResetNoticeView firmware={firmware} backupLine={newest ? describeSnapshot(newest) : null} busy={busy} error={error} onDefaults={acknowledgeReset} onOtherBackups={otherBackups} onPutBack={putBack} />
            </DialogContent>
        </Dialog>
    );
}
