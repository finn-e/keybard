// Automatic backups: snapshots of each connected board's configuration in
// IndexedDB, optionally mirrored into a folder on disk.

import { fingerprintSvil, gunzipText, gzipText } from "./codec";
import { summarizeSvilChange } from "./diff-summary";
import { emptyManifest, FolderBackupWriter, FolderGoneError, isPermissionError, type FolderDirectoryHandle, type FolderManifest } from "./folder";
import { snapshotsToPrune } from "./retention";
import { IndexedDbBackupStore, PINNED_SNAPSHOT_KINDS, type BackupStore, type SnapshotKind, type SnapshotMeta } from "./store";

export type { SnapshotMeta, SnapshotKind } from "./store";
export { PINNED_SNAPSHOT_KINDS } from "./store";

const HANDLE_KEY = "folderHandle";
const MANIFEST_KEY = "folderManifest";

/**
 * none: no folder chosen. active: writing. paused: the browser needs permission
 * again (Resume). lost: the folder was moved or deleted; choose another.
 */
export type FolderState = "none" | "active" | "paused" | "lost";

export interface FolderStatus {
    state: FolderState;
    name: string | null;
    error: string | null;
}

export interface SnapshotInput {
    boardKey: string;
    boardName: string;
    svil: string;
    kind: SnapshotKind;
    pendingCount: number;
    /** pre-update snapshots: the release installed before, and the one being installed. */
    fromTag?: string;
    toTag?: string;
}

export interface BackupServiceOptions {
    now?: () => number;
    pickFolder?: () => Promise<FolderDirectoryHandle>;
}

export function folderPickerSupported(): boolean {
    return typeof window !== "undefined" && typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === "function";
}

const defaultPicker = () =>
    (window as unknown as { showDirectoryPicker: (o: object) => Promise<FolderDirectoryHandle> })
        .showDirectoryPicker({ id: "keybard-backups", mode: "readwrite", startIn: "documents" });

let idCounter = 0;
const newId = (time: number) => `${time.toString(36)}-${(idCounter++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export class BackupService {
    private now: () => number;
    private pickFolder: () => Promise<FolderDirectoryHandle>;
    private handle: FolderDirectoryHandle | null = null;
    private folder: FolderStatus = { state: "none", name: null, error: null };
    private listeners = new Set<() => void>();
    private chain: Promise<unknown> = Promise.resolve();
    private initialized: Promise<void> | null = null;

    constructor(private store: BackupStore, options: BackupServiceOptions = {}) {
        this.now = options.now ?? Date.now;
        this.pickFolder = options.pickFolder ?? defaultPicker;
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }

    private emit() {
        for (const l of this.listeners) l();
    }

    /** Run store-mutating work one at a time. */
    private serial<T>(work: () => Promise<T>): Promise<T> {
        const run = this.chain.then(work, work);
        this.chain = run.catch(() => undefined);
        return run;
    }

    getFolderStatus(): FolderStatus {
        return this.folder;
    }

    private setFolder(state: FolderState, error: string | null = null) {
        this.folder = { state, name: this.handle?.name ?? null, error };
        this.emit();
    }

    /** Load the saved folder and check access without prompting. */
    init(): Promise<void> {
        if (!this.initialized) {
            this.initialized = this.serial(async () => {
                const handle = await this.store.getValue<FolderDirectoryHandle>(HANDLE_KEY);
                if (!handle) return;
                this.handle = handle;
                const permission = await handle.queryPermission?.({ mode: "readwrite" }) ?? "granted";
                this.setFolder(permission === "granted" ? "active" : "paused");
                if (permission === "granted") await this.syncFolder();
            }).catch((error) => { console.warn("[Backups] init failed", error); });
        }
        return this.initialized;
    }

    async listSnapshots(): Promise<SnapshotMeta[]> {
        return (await this.store.listSnapshots()).sort((a, b) => b.savedAt - a.savedAt);
    }

    async getSvil(id: string): Promise<string> {
        const data = await this.store.getSnapshotData(id);
        if (!data) throw new Error("This backup is no longer stored.");
        return gunzipText(data);
    }

    deleteSnapshot(id: string): Promise<void> {
        return this.serial(async () => {
            await this.store.deleteSnapshots([id]);
            this.emit();
        });
    }

    /**
     * Store a snapshot unless it matches the board's latest one. Returns the new
     * snapshot, or null when nothing changed.
     */
    saveSnapshot(input: SnapshotInput): Promise<SnapshotMeta | null> {
        return this.serial(async () => {
            const fingerprint = await fingerprintSvil(input.svil);
            const all = await this.store.listSnapshots();
            const board = all.filter((s) => s.boardKey === input.boardKey).sort((a, b) => b.savedAt - a.savedAt);
            const latest = board[0];
            const includesPending = input.pendingCount > 0;
            const pinned = PINNED_SNAPSHOT_KINDS.includes(input.kind);
            // A pinned snapshot is always its own entry, even when the content matches the latest.
            if (!pinned && latest && latest.fingerprint === fingerprint) {
                // Same content. Track whether it now matches the board (changes applied).
                if (latest.includesPending !== includesPending || latest.pendingCount !== input.pendingCount) {
                    await this.store.updateSnapshot({ ...latest, includesPending, pendingCount: input.pendingCount });
                    this.emit();
                }
                return null;
            }
            const savedAt = Math.max(this.now(), (latest?.savedAt ?? 0) + 1);
            const previous = latest ? await this.getSvil(latest.id).catch(() => null) : null;
            const meta: SnapshotMeta = {
                id: newId(savedAt),
                boardKey: input.boardKey,
                boardName: input.boardName,
                savedAt,
                kind: input.kind,
                fingerprint,
                includesPending,
                pendingCount: input.pendingCount,
                summary: summarizeSvilChange(previous, input.svil),
                size: new TextEncoder().encode(input.svil).length,
                ...(input.fromTag !== undefined ? { fromTag: input.fromTag } : {}),
                ...(input.toTag !== undefined ? { toTag: input.toTag } : {}),
            };
            await this.store.putSnapshot(meta, await gzipText(input.svil));
            const retained = [...board, meta].filter((s) => !PINNED_SNAPSHOT_KINDS.includes(s.kind));
            const prune = snapshotsToPrune(retained, this.now());
            await this.store.deleteSnapshots(prune);
            this.emit();
            if (this.folder.state === "active") await this.syncFolder(input.boardKey);
            return meta;
        });
    }

    /** Write whatever the folder is missing, for one board or all of them. */
    private async syncFolder(boardKey?: string): Promise<void> {
        if (!this.handle) return;
        const manifest = (await this.store.getValue<FolderManifest>(MANIFEST_KEY)) ?? emptyManifest();
        const snapshots = await this.store.listSnapshots();
        const boards = boardKey ? [boardKey] : [...new Set(snapshots.map((s) => s.boardKey))];
        const writer = new FolderBackupWriter(this.handle);
        try {
            for (const key of boards) {
                await writer.syncBoard(key, snapshots, (id) => this.getSvil(id), manifest, this.now());
            }
            if (this.folder.error) this.setFolder("active");
        } catch (error) {
            if (error instanceof FolderGoneError) {
                await this.forgetFolder();
                this.setFolder("lost");
                return;
            }
            if (isPermissionError(error)) {
                this.setFolder("paused");
            } else {
                console.warn("[Backups] folder write failed", error);
                this.setFolder("active", error instanceof Error ? error.message : String(error));
            }
        } finally {
            if (this.handle) await this.store.setValue(MANIFEST_KEY, manifest);
        }
    }

    private async forgetFolder() {
        this.handle = null;
        await this.store.deleteValue(HANDLE_KEY);
        await this.store.deleteValue(MANIFEST_KEY);
    }

    /** Ask for a folder (needs a user gesture), then write all boards into it. */
    async chooseFolder(): Promise<boolean> {
        let handle: FolderDirectoryHandle;
        try {
            handle = await this.pickFolder();
        } catch (error) {
            if (errorIsAbort(error)) return false;
            throw error;
        }
        await this.serial(async () => {
            this.handle = handle;
            await this.store.setValue(HANDLE_KEY, handle);
            // A different folder: nothing in it was written by Keybard yet.
            await this.store.setValue(MANIFEST_KEY, emptyManifest());
            this.setFolder("active");
            await this.syncFolder();
        });
        return true;
    }

    /** Re-request access to the saved folder (needs a user gesture). */
    async resumeFolder(): Promise<boolean> {
        const handle = this.handle;
        if (!handle) return false;
        const permission = await handle.requestPermission?.({ mode: "readwrite" }) ?? "granted";
        if (permission !== "granted") return false;
        await this.serial(async () => {
            this.setFolder("active");
            await this.syncFolder();
        });
        return true;
    }

    stopFolder(): Promise<void> {
        return this.serial(async () => {
            await this.forgetFolder();
            this.setFolder("none");
        });
    }
}

function errorIsAbort(error: unknown): boolean {
    return !!error && typeof error === "object" && "name" in error && (error as { name: unknown }).name === "AbortError";
}

let shared: BackupService | null = null;

/** The app's backup service, or null where IndexedDB is unavailable. */
export function getBackupService(): BackupService | null {
    if (!shared && typeof indexedDB !== "undefined") shared = new BackupService(new IndexedDbBackupStore());
    return shared;
}
