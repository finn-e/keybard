// Takes automatic snapshots of the connected board and exposes the backup list.
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useKeyboard } from "@/contexts/KeyboardContext";
import { useChanges } from "@/contexts/ChangesContext";
import { fileService } from "@/services/file.service";
import { identityService, SerialSource, type IdentityInfo } from "@/services/identity.service";
import { folderPickerSupported, getBackupService, type BackupService, type FolderStatus, type SnapshotKind, type SnapshotMeta } from "@/services/backup/backup.service";
import type { KeyboardInfo } from "@/types/keyboard.types";
import { comboNamesFromSvil, seedComboNames } from "@/utils/combo-names";

/** Wait this long after the last edit before saving an "edited" snapshot. */
export const EDIT_SETTLE_MS = 10_000;

export interface BoardRef {
    key: string;
    name: string;
}

interface BackupContextType {
    available: boolean;
    snapshots: SnapshotMeta[];
    folder: FolderStatus;
    folderSupported: boolean;
    /** The connected board, once identified. */
    board: BoardRef | null;
    getSvil: (id: string) => Promise<string>;
    deleteSnapshot: (id: string) => Promise<void>;
    chooseFolder: () => Promise<void>;
    resumeFolder: () => Promise<void>;
    stopFolder: () => Promise<void>;
    /** A manual snapshot of the connected board now, kept until deleted. */
    backUpNow: () => Promise<void>;
}

const BackupContext = createContext<BackupContextType | undefined>(undefined);

const NO_FOLDER: FolderStatus = { state: "none", name: null, error: null };

/** The persistent serial when the firmware has one, otherwise the keyboard UID. */
export function boardKeyFor(identity: IdentityInfo | null, keyboard: KeyboardInfo): string | null {
    if (identity && identity.serialSource !== SerialSource.None && !/^sval:0+$/.test(identity.serial)) return identity.serial;
    if (keyboard.kbid) return `uid:${keyboard.kbid.toUpperCase()}`;
    return null;
}

/** Names from the board's latest backup that still fit its combos, or null. Never throws. */
async function restoreComboNames(service: BackupService, boardKey: string, loaded: KeyboardInfo): Promise<Record<string, string> | null> {
    try {
        const latest = (await service.listSnapshots()).find(s => s.boardKey === boardKey);
        if (!latest) return null;
        return seedComboNames(comboNamesFromSvil(await service.getSvil(latest.id)), loaded);
    } catch (error) {
        console.warn("[Backups] could not restore combo names", error);
        return null;
    }
}

export function serializeForBackup(keyboard: KeyboardInfo): string {
    return fileService.kbinfoToSvil(structuredClone(keyboard), true);
}

interface BackupProviderProps {
    children: React.ReactNode;
    service?: BackupService | null;
    readIdentity?: () => Promise<IdentityInfo | null>;
}

export const BackupProvider: React.FC<BackupProviderProps> = ({ children, service: injected, readIdentity = () => identityService.getInfo() }) => {
    const service = injected === undefined ? getBackupService() : injected;
    const { keyboard, setKeyboard, isConnected, connectionSessionId, loadedFrom } = useKeyboard();
    const { getPendingCount } = useChanges();
    const pendingCount = getPendingCount();
    const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([]);
    const [folder, setFolder] = useState<FolderStatus>(service?.getFolderStatus() ?? NO_FOLDER);
    const [board, setBoard] = useState<(BoardRef & { session: number }) | null>(null);

    const keyboardRef = useRef(keyboard);
    keyboardRef.current = keyboard;
    const pendingRef = useRef(pendingCount);
    pendingRef.current = pendingCount;
    const sessionRef = useRef(connectionSessionId);
    sessionRef.current = connectionSessionId;
    const boardRef = useRef(board);
    boardRef.current = board;
    const readIdentityRef = useRef(readIdentity);
    readIdentityRef.current = readIdentity;
    const setKeyboardRef = useRef(setKeyboard);
    setKeyboardRef.current = setKeyboard;

    const refresh = useCallback(async () => {
        if (!service) return;
        setSnapshots(await service.listSnapshots());
        setFolder(service.getFolderStatus());
    }, [service]);

    useEffect(() => {
        if (!service) return;
        const unsubscribe = service.subscribe(() => { void refresh(); });
        void service.init().then(refresh);
        return unsubscribe;
    }, [service, refresh]);

    const save = useCallback(async (target: BoardRef, kbinfo: KeyboardInfo, kind: SnapshotKind) => {
        if (!service) return;
        try {
            await service.saveSnapshot({ boardKey: target.key, boardName: target.name, svil: serializeForBackup(kbinfo), kind, pendingCount: pendingRef.current });
        } catch (error) {
            console.warn("[Backups] snapshot failed", error);
        }
    }, [service]);

    // 1. Right after a board connects and finishes loading, before any edits.
    const connectedSession = useRef<number | null>(null);
    useEffect(() => {
        if (!service || !isConnected || !keyboard || connectedSession.current === connectionSessionId) return;
        connectedSession.current = connectionSessionId;
        const session = connectionSessionId;
        const loaded = structuredClone(keyboard);
        void (async () => {
            const identity = await readIdentityRef.current().catch(() => null);
            if (sessionRef.current !== session) return;
            const key = boardKeyFor(identity, loaded);
            if (!key) return;
            const target = { key, name: identity?.name || loadedFrom || loaded.name || "Keyboard" };
            setBoard({ ...target, session });
            // Combo names live only in Keybard: bring them back from this board's
            // latest backup, for the combos that are unchanged, before the
            // connected snapshot is taken (so it keeps them too).
            const seeded = await restoreComboNames(service, key, loaded);
            if (sessionRef.current !== session) return;
            if (seeded) {
                loaded.cosmetic = { ...loaded.cosmetic, combos: { ...seeded, ...loaded.cosmetic?.combos } };
                setKeyboardRef.current?.(cur => {
                    if (!cur || sessionRef.current !== session) return cur;
                    // Check again against the live state: a combo edited meanwhile keeps no old name.
                    const names = seedComboNames({ combos: loaded.combos, cosmetic: { combos: seeded } } as KeyboardInfo, cur);
                    return names ? { ...cur, cosmetic: { ...cur.cosmetic, combos: { ...names, ...cur.cosmetic?.combos } } } : cur;
                });
            }
            await save(target, loaded, "connected");
        })();
    }, [service, isConnected, keyboard, connectionSessionId, loadedFrom, save]);

    // Offline files and other boards start a new session; stop backing up the old one.
    const current = board && board.session === connectionSessionId ? board : null;

    // 2. After the board's state stops changing.
    const timer = useRef<number | undefined>(undefined);
    const flush = useCallback(() => {
        window.clearTimeout(timer.current);
        timer.current = undefined;
        const target = boardRef.current;
        const kbinfo = keyboardRef.current;
        if (target && kbinfo && target.session === sessionRef.current) void save(target, kbinfo, "edited");
    }, [save]);
    useEffect(() => {
        if (!current || !keyboard) return;
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(flush, EDIT_SETTLE_MS);
    }, [current, keyboard, pendingCount, flush]);
    useEffect(() => () => window.clearTimeout(timer.current), []);

    // 3. When the tab is hidden (switching away, closing): save now, best effort.
    useEffect(() => {
        const onVisibility = () => { if (document.visibilityState === "hidden" && timer.current !== undefined) flush(); };
        document.addEventListener("visibilitychange", onVisibility);
        return () => document.removeEventListener("visibilitychange", onVisibility);
    }, [flush]);

    const getSvil = useCallback((id: string) => service ? service.getSvil(id) : Promise.reject(new Error("Backups are unavailable.")), [service]);
    const deleteSnapshot = useCallback(async (id: string) => { await service?.deleteSnapshot(id); }, [service]);
    const chooseFolder = useCallback(async () => { await service?.chooseFolder(); }, [service]);
    const resumeFolder = useCallback(async () => { await service?.resumeFolder(); }, [service]);
    const stopFolder = useCallback(async () => { await service?.stopFolder(); }, [service]);

    const backUpNow = useCallback(async () => {
        const target = boardRef.current;
        const kbinfo = keyboardRef.current;
        if (!service || !target || !kbinfo || target.session !== sessionRef.current) throw new Error("Connect your keyboard to back it up.");
        await service.saveSnapshot({ boardKey: target.key, boardName: target.name, svil: serializeForBackup(kbinfo), kind: "manual", pendingCount: pendingRef.current });
    }, [service]);

    const folderSupported = folderPickerSupported();

    const value: BackupContextType = {
        available: !!service,
        snapshots,
        folder,
        folderSupported,
        board: current ? { key: current.key, name: current.name } : null,
        getSvil,
        deleteSnapshot,
        chooseFolder,
        resumeFolder,
        stopFolder,
        backUpNow,
    };
    return <BackupContext.Provider value={value}>{children}</BackupContext.Provider>;
};

export const useBackups = (): BackupContextType => {
    const context = useContext(BackupContext);
    if (!context) throw new Error("useBackups must be used within a BackupProvider");
    return context;
};
