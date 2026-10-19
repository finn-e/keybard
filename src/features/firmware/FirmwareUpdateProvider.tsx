// The firmware update, app-wide: one controller and one dialog for the editor, so an update
// started in Settings > Firmware keeps its dialog wherever the user is, and a reload mid-update
// picks it back up. Also the rail dot, and the "open Firmware" and "open Backups" requests.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { OPEN_BACKUPS_EVENT } from "@/components/StorageResetDialog";
import { currentSite, releasesForSite, type FirmwareReleasePin } from "@/constants/firmware-releases";
import { serializeForBackup, useBackups } from "@/contexts/BackupContext";
import { useKeyboard } from "@/contexts/KeyboardContext";
import { usePanels } from "@/contexts/PanelsContext";
import { requestSettingsSection } from "@/layout/SecondarySidebar/Panels/settings/anchor";
import type { Hand } from "@/services/updater/protocol";
import type { BoardSummary } from "./board-summary";
import { loadCarriedRelease } from "./carried";
import type { FailureAction } from "./failures";
import type { FirmwarePick } from "./FirmwareSection";
import { ManualInstall } from "./ManualInstall";
import { UpdateDialog } from "./UpdateDialog";
import { backupFileName, downloadText, useAppFirmwareHost } from "./useAppFirmwareHost";
import { useFirmwareStatus, type FirmwareStatus } from "./useFirmwareStatus";
import { useFirmwareUpdate, type FirmwareUiHost } from "./useFirmwareUpdate";
import { OPEN_FIRMWARE_EVENT, useBoardSummary } from "./useHalvesDiffer";

export interface FirmwareUpdates {
    /** What the connected board runs (null: none, or still reading). */
    board: BoardSummary | null;
    /** A keyboard is connected and its firmware is still being read. */
    reading: boolean;
    releases: FirmwareReleasePin[];
    status: FirmwareStatus;
    install: (pick: FirmwarePick, onlyHand?: Hand) => void;
    openManual: (release: FirmwareReleasePin | null) => void;
    connect: () => void;
}

const FirmwareUpdatesContext = createContext<FirmwareUpdates | null>(null);

/** The app's firmware updates; null outside the editor (the connect screen, tests). */
export function useFirmwareUpdates(): FirmwareUpdates | null {
    return useContext(FirmwareUpdatesContext);
}

/** Open Settings at a section, from anywhere in the editor. */
function useOpenSettingsSection() {
    const { setActivePanel, openDetails, setPanelToGoBack, setItemToEdit } = usePanels();
    return useCallback((id: string) => {
        requestSettingsSection(id);
        setActivePanel("settings");
        openDetails();
        setPanelToGoBack(null);
        setItemToEdit(null);
    }, [setActivePanel, openDetails, setPanelToGoBack, setItemToEdit]);
}

export interface FirmwareUpdateProviderProps {
    children: ReactNode;
    /** Dev and tests: a host other than the WebHID connection (the mock board). */
    host?: FirmwareUiHost | null;
    /** Dev and tests: the board summary, when the host isn't the app's connection. */
    readBoard?: () => Promise<BoardSummary | null>;
    releases?: FirmwareReleasePin[];
    files?: (pin: FirmwareReleasePin) => ReturnType<typeof loadCarriedRelease>;
}

export function FirmwareUpdateProvider({ children, host: injected, readBoard, releases: givenReleases, files }: FirmwareUpdateProviderProps) {
    const kb = useKeyboard();
    const backups = useBackups();
    const appHost = useAppFirmwareHost();
    const host = injected === undefined ? appHost : injected;
    const releases = useMemo(() => givenReleases ?? releasesForSite(currentSite()), [givenReleases]);
    const fw = useFirmwareUpdate(host, { releases });
    const [manual, setManual] = useState<FirmwareReleasePin | null | undefined>(undefined);
    const openSection = useOpenSettingsSection();

    // The board: from the connection, re-read after each update or dialog close.
    const [refresh, setRefresh] = useState(0);
    const appBoard = useBoardSummary(refresh);
    const [injectedBoard, setInjectedBoard] = useState<BoardSummary | null>(null);
    useEffect(() => {
        if (!readBoard) return;
        let cancelled = false;
        void readBoard().then((b) => { if (!cancelled) setInjectedBoard(b); }).catch(() => undefined);
        return () => { cancelled = true; };
    }, [readBoard, refresh]);
    useEffect(() => { if (fw.ui.kind === "idle") setRefresh((n) => n + 1); }, [fw.ui.kind]);
    const board = readBoard ? injectedBoard : appBoard;
    const status = useFirmwareStatus(board, { releases });

    const install = useCallback((pick: FirmwarePick, onlyHand?: Hand) => {
        if (pick.kind === "files") return void fw.openSheet({ kind: "file", files: pick.files }, onlyHand);
        void (async () => {
            const loaded = await (files ?? loadCarriedRelease)(pick.release);
            await fw.openSheet({ kind: "release", release: pick.release, files: loaded }, onlyHand);
        })().catch((error) => console.warn("[firmware] couldn't load the release", error));
    }, [fw, files]);

    // Requests from elsewhere: the halves-differ banner, the reset dialog's "Other backups".
    useEffect(() => {
        const toFirmware = () => openSection("firmware");
        const toBackups = () => openSection("backups");
        window.addEventListener(OPEN_FIRMWARE_EVENT, toFirmware);
        window.addEventListener(OPEN_BACKUPS_EVENT, toBackups);
        return () => {
            window.removeEventListener(OPEN_FIRMWARE_EVENT, toFirmware);
            window.removeEventListener(OPEN_BACKUPS_EVENT, toBackups);
        };
    }, [openSection]);

    const onFailureAction = (a: FailureAction) => {
        if (a === "retry") fw.retry();
        else if (a === "finish") fw.finish();
        else if (a === "reload") location.reload();
        else if (a === "manual" || a === "download") { fw.close(); setManual(releases[0] ?? null); }
        else if (a === "backups") { fw.close(); openSection("backups"); }
        else fw.close();
    };

    // The automatic backup failed: let the user save the layout as a file now.
    const saveManually = useCallback(() => {
        if (!kb.keyboard) return;
        const from = board?.tag ?? "";
        downloadText(serializeForBackup(kb.keyboard), backupFileName(backups.board?.name ?? kb.keyboard.name ?? "Svalboard", from));
    }, [kb.keyboard, board?.tag, backups.board?.name]);

    const value = useMemo<FirmwareUpdates>(() => ({
        board, reading: !readBoard && kb.isConnected && !board, releases, status, install, openManual: (r) => setManual(r), connect: () => void kb.connect(),
    }), [board, readBoard, releases, status, install, kb]);

    return (
        <FirmwareUpdatesContext.Provider value={value}>
            {children}
            {host && (
                <UpdateDialog
                    ui={fw.ui}
                    now={() => host.clock.now()}
                    chordLegends={(h) => host.chordLegends(h)}
                    cancellable={!!fw.flow?.cancellable}
                    notesUrl={releases.find((r) => fw.ui.kind === "flow" && r.tag === fw.ui.state.toTag)?.notesUrl}
                    onAfterwards={fw.setAfterwards}
                    onStart={fw.start}
                    onCancel={() => (fw.ui.kind === "flow" ? fw.flow?.cancel() : fw.close())}
                    onClose={fw.close}
                    onFailureAction={onFailureAction}
                    onSaveManually={saveManually}
                />
            )}
            {manual !== undefined && (
                <Dialog open onOpenChange={(open) => { if (!open) setManual(undefined); }}>
                    <DialogContent className="sm:max-w-[520px]" onInteractOutside={(e) => e.preventDefault()}>
                        <DialogTitle className="sr-only">Install firmware by hand</DialogTitle>
                        <DialogDescription className="sr-only">Download the firmware and copy it onto each half</DialogDescription>
                        <ManualInstall
                            release={manual}
                            backup={null}
                            afterwards="defaults"
                            onAfterwards={() => undefined}
                            connected={kb.isConnected}
                            onConnect={() => { setManual(undefined); void kb.connect(); }}
                            onClose={() => setManual(undefined)}
                        />
                    </DialogContent>
                </Dialog>
            )}
        </FirmwareUpdatesContext.Provider>
    );
}
