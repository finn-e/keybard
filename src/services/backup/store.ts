// Persistence for backups. IndexedDB in the app, an in-memory twin in tests.

/**
 * connected: right after a board connects. edited: after edits settle.
 * pre-update: taken by a firmware install before anything is sent ("Before <release>").
 * manual: the user's own "Back up now". The last two are kept until the user deletes them.
 */
export type SnapshotKind = "connected" | "edited" | "pre-update" | "manual";

/** Kinds retention never removes. */
export const PINNED_SNAPSHOT_KINDS: readonly SnapshotKind[] = ["pre-update", "manual"];

export interface SnapshotMeta {
    id: string;
    /** Persistent board serial (e.g. "sval:E46498769F365934"), or "uid:<hex>" without one. */
    boardKey: string;
    boardName: string;
    savedAt: number;
    kind: SnapshotKind;
    /** SHA-256 of the .svil content. */
    fingerprint: string;
    /** Edits not yet sent to the board (Live Updating off) are included. */
    includesPending: boolean;
    pendingCount: number;
    /** What changed since the board's previous snapshot, e.g. "3 keys, 1 macro". */
    summary: string;
    /** Size of the uncompressed .svil in bytes. */
    size: number;
    /** pre-update: the release installed before, and the one being installed. */
    fromTag?: string;
    toTag?: string;
}

export interface BackupStore {
    listSnapshots(): Promise<SnapshotMeta[]>;
    getSnapshotData(id: string): Promise<Uint8Array | undefined>;
    putSnapshot(meta: SnapshotMeta, data: Uint8Array): Promise<void>;
    updateSnapshot(meta: SnapshotMeta): Promise<void>;
    deleteSnapshots(ids: string[]): Promise<void>;
    /** Small settings: the folder handle, the folder manifest. Values must be structured-cloneable. */
    getValue<T>(key: string): Promise<T | undefined>;
    setValue(key: string, value: unknown): Promise<void>;
    deleteValue(key: string): Promise<void>;
}

export class MemoryBackupStore implements BackupStore {
    meta = new Map<string, SnapshotMeta>();
    data = new Map<string, Uint8Array>();
    values = new Map<string, unknown>();
    async listSnapshots() { return [...this.meta.values()].map((m) => ({ ...m })); }
    async getSnapshotData(id: string) { return this.data.get(id); }
    async putSnapshot(meta: SnapshotMeta, data: Uint8Array) { this.meta.set(meta.id, { ...meta }); this.data.set(meta.id, data); }
    async updateSnapshot(meta: SnapshotMeta) { if (this.meta.has(meta.id)) this.meta.set(meta.id, { ...meta }); }
    async deleteSnapshots(ids: string[]) { for (const id of ids) { this.meta.delete(id); this.data.delete(id); } }
    async getValue<T>(key: string) { return this.values.get(key) as T | undefined; }
    async setValue(key: string, value: unknown) { this.values.set(key, value); }
    async deleteValue(key: string) { this.values.delete(key); }
}

const DB_NAME = "keybard-backups";
const DB_VERSION = 1;
const META = "snapshots";
const DATA = "snapshotData";
const VALUES = "values";

function request<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function done(tx: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new Error("Backup transaction aborted"));
    });
}

export class IndexedDbBackupStore implements BackupStore {
    private db: Promise<IDBDatabase> | null = null;

    private open(): Promise<IDBDatabase> {
        if (!this.db) {
            this.db = new Promise((resolve, reject) => {
                const req = indexedDB.open(DB_NAME, DB_VERSION);
                req.onupgradeneeded = () => {
                    const db = req.result;
                    if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: "id" });
                    if (!db.objectStoreNames.contains(DATA)) db.createObjectStore(DATA);
                    if (!db.objectStoreNames.contains(VALUES)) db.createObjectStore(VALUES);
                };
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
            this.db.catch(() => { this.db = null; });
        }
        return this.db;
    }

    async listSnapshots(): Promise<SnapshotMeta[]> {
        const db = await this.open();
        return request(db.transaction(META).objectStore(META).getAll() as IDBRequest<SnapshotMeta[]>);
    }

    async getSnapshotData(id: string): Promise<Uint8Array | undefined> {
        const db = await this.open();
        return request(db.transaction(DATA).objectStore(DATA).get(id) as IDBRequest<Uint8Array | undefined>);
    }

    async putSnapshot(meta: SnapshotMeta, data: Uint8Array): Promise<void> {
        const db = await this.open();
        const tx = db.transaction([META, DATA], "readwrite");
        tx.objectStore(META).put(meta);
        tx.objectStore(DATA).put(data, meta.id);
        await done(tx);
    }

    async updateSnapshot(meta: SnapshotMeta): Promise<void> {
        const db = await this.open();
        const tx = db.transaction(META, "readwrite");
        tx.objectStore(META).put(meta);
        await done(tx);
    }

    async deleteSnapshots(ids: string[]): Promise<void> {
        if (!ids.length) return;
        const db = await this.open();
        const tx = db.transaction([META, DATA], "readwrite");
        for (const id of ids) {
            tx.objectStore(META).delete(id);
            tx.objectStore(DATA).delete(id);
        }
        await done(tx);
    }

    async getValue<T>(key: string): Promise<T | undefined> {
        const db = await this.open();
        return request(db.transaction(VALUES).objectStore(VALUES).get(key) as IDBRequest<T | undefined>);
    }

    async setValue(key: string, value: unknown): Promise<void> {
        const db = await this.open();
        const tx = db.transaction(VALUES, "readwrite");
        tx.objectStore(VALUES).put(value, key);
        await done(tx);
    }

    async deleteValue(key: string): Promise<void> {
        const db = await this.open();
        const tx = db.transaction(VALUES, "readwrite");
        tx.objectStore(VALUES).delete(key);
        await done(tx);
    }
}
