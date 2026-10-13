import { PendingChange, changesUtils, ChangeQueue, type KeyBlockWriter } from "@/services/changes.service";
import React, { ReactNode, createContext, useCallback, useContext, useState, useEffect, useRef } from "react";
import { useSettings } from "@/contexts/SettingsContext";

interface ChangesContextType {
    registerUndo: (label: string, callback: () => Promise<void> | void) => void;
    undo: () => Promise<void>;
    undoLabel: string | null;
    todo: Record<string, PendingChange>;
    isInstant: boolean;
    setInstant: (instant: boolean) => Promise<boolean>;
    isSaving: boolean;
    error: string | null;
    queue: (desc: string, cb: () => Promise<void>, metadata?: Partial<PendingChange>) => Promise<void>;
    clear: (desc: string) => void;
    commit: () => Promise<boolean>;
    clearAll: () => void;
    // Helper functions
    getPendingChanges: () => PendingChange[];
    getPendingCount: () => number;
    getChangesForLayer: (layer: number) => PendingChange[];
    getChangesByType: (type: PendingChange["type"]) => PendingChange[];
    hasPendingChangeForKey: (layer: number, row: number, col: number) => boolean;
    getPendingChangeForKey: (layer: number, row: number, col: number) => PendingChange | null;
}

const ChangesContext = createContext<ChangesContextType | undefined>(undefined);

interface ChangesProviderProps {
    children: ReactNode;
    onPush?: () => void;
    captureSave?: () => (() => void);
    canWrite?: boolean;
    sessionKey?: string | number;
    registerTargetChangeGuard?: (guard: () => Promise<(discardPending?: boolean) => void>) => (() => void);
    /** Writes key changes a block at a time; without it each key change runs its own callback. */
    keyBlockWriter?: () => KeyBlockWriter | null;
}

export const ChangesProvider: React.FC<ChangesProviderProps> = ({ children, onPush, captureSave, canWrite = true, sessionKey, registerTargetChangeGuard, keyBlockWriter }) => {
    const [, render] = useState(0);
    const [undoLabel, setUndoLabel] = useState<string | null>(null);
    const undoRef = useRef<(() => Promise<void> | void) | null>(null);
    const undoing = useRef(false);
    const registerUndo = useCallback((label: string, callback: () => Promise<void> | void) => {
        if (undoing.current) return;
        undoRef.current = callback;
        setUndoLabel(label);
    }, []);
    const writable = useRef(canWrite);
    writable.current = canWrite;
    const onPushRef = useRef(onPush);
    onPushRef.current = onPush;
    const captureRef = useRef(captureSave);
    captureRef.current = captureSave;
    const keyWriterRef = useRef(keyBlockWriter);
    keyWriterRef.current = keyBlockWriter;
    const engineRef = useRef<ChangeQueue | null>(null);
    if (!engineRef.current) engineRef.current = new ChangeQueue(() => render(n => n + 1), () => writable.current, () => captureRef.current?.() || (() => onPushRef.current?.()), () => keyWriterRef.current?.() ?? null);
    const engine = engineRef.current;
    const { getSetting, updateSetting } = useSettings();
    const [isInstant, setInstantState] = useState(getSetting("live-updating") === true);
    const instantRef = useRef(isInstant);
    const sessionRef = useRef(sessionKey);
    useEffect(() => {
        if (sessionRef.current !== sessionKey) {
            sessionRef.current = sessionKey;
            engine.reset();
            undoRef.current = null;
            setUndoLabel(null);
        }
    }, [sessionKey, engine]);

    const commit = useCallback(async () => {
        return engine.commit();
    }, [engine]);
    const setInstant = useCallback(async (instant: boolean) => {
        if (instant && !instantRef.current && !(await commit())) return false;
        instantRef.current = instant;
        setInstantState(instant);
        return true;
    }, [commit]);
    useEffect(() => {
        const requested = getSetting("live-updating") === true;
        if (requested !== instantRef.current) {
            void setInstant(requested).then(ok => { if (!ok) updateSetting("live-updating", false); });
        }
    }, [getSetting, setInstant, updateSetting]);

    const queue = useCallback(async (desc: string, cb: () => Promise<void>, metadata?: Partial<PendingChange>) => {
        // Offline drafts never retain callbacks capable of writing to a later board.
        if (!writable.current) return;
        engine.add(desc, cb, metadata);
        if (instantRef.current && !metadata?.deferCommit) await commit();
    }, [engine, commit]);
    const clear = useCallback((desc: string) => engine.clear(desc), [engine]);
    const clearAll = useCallback(() => { if (!engine.isSaving) { engine.reset(); undoRef.current = null; setUndoLabel(null); } }, [engine]);
    useEffect(() => registerTargetChangeGuard?.(async () => {
        const release = await engine.suspendAndDrain();
        return (discardPending = false) => {
            if (discardPending) { undoRef.current = null; setUndoLabel(null); }
            release(discardPending);
        };
    }), [engine, registerTargetChangeGuard]);
    const undo = useCallback(async () => {
        if (!undoRef.current || engine.isSaving || undoing.current) return;
        const callback = undoRef.current;
        undoing.current = true;
        try {
            await callback();
            undoRef.current = null;
            setUndoLabel(null);
        } catch (error) {
            engine.error = error instanceof Error ? error.message : String(error);
            render(n => n + 1);
        } finally { undoing.current = false; }
    }, [engine]);
    const todo = engine.pending;
    // Helper functions using the current todo state
    const getPendingChanges = useCallback(() => Object.values(todo), [todo]);
    const getPendingCount = useCallback(() => Object.keys(todo).length, [todo]);
    const getChangesForLayer = useCallback((layer: number) => changesUtils.getChangesForLayer(todo, layer), [todo]);
    const getChangesByType = useCallback((type: PendingChange["type"]) => changesUtils.getChangesByType(todo, type), [todo]);
    const hasPendingChangeForKey = useCallback((layer: number, row: number, col: number) => changesUtils.hasPendingChangeForKey(todo, layer, row, col), [todo]);
    const getPendingChangeForKey = useCallback((layer: number, row: number, col: number) => changesUtils.getPendingChangeForKey(todo, layer, row, col), [todo]);

    const value: ChangesContextType = {
        todo,
        registerUndo, undo, undoLabel,
        isSaving: engine.isSaving,
        error: engine.error,
        isInstant,
        setInstant,
        queue,
        clear,
        commit,
        clearAll,
        getPendingChanges,
        getPendingCount,
        getChangesForLayer,
        getChangesByType,
        hasPendingChangeForKey,
        getPendingChangeForKey,
    };

    return <ChangesContext.Provider value={value}>{children}</ChangesContext.Provider>;
};

export const useChanges = (): ChangesContextType => {
    const context = useContext(ChangesContext);
    if (!context) {
        throw new Error("useChanges must be used within a ChangesProvider");
    }
    return context;
};
