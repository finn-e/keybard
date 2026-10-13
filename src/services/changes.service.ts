export interface PendingChange {
    desc: string;
    writeKey?: string;
    deferCommit?: boolean;
    cb: () => Promise<void>;
    timestamp: number;
    // Metadata for UI display and tracking
    type: "key" | "macro" | "combo" | "tapdance" | "override" | "setting" | "label" | "custom_ui";
    layer?: number;
    row?: number;
    col?: number;
    keycode?: number;
    comboId?: number;
    comboSlot?: number;
    tapdanceId?: number;
    tapdanceSlot?: "tap" | "hold" | "doubletap" | "taphold";
    previousValue?: number | string;
}

// Simple utility functions for the changes queue - no class or listeners needed
export const changesUtils = {
    /**
     * Execute a change immediately or return it for queueing
     */
    async processChange(desc: string, cb: () => Promise<void>, metadata: Partial<PendingChange>, instant: boolean): Promise<PendingChange | null> {
        if (instant) {
            await cb();
            return null; // No need to queue
        } else {
            return {
                desc,
                cb,
                timestamp: Date.now(),
                type: metadata?.type || "key",
                ...metadata,
            };
        }
    },

    /**
     * Commit all pending changes
     */
    async commitChanges(todo: Record<string, PendingChange>): Promise<void> {
        for (const [, change] of Object.entries(todo)) {
            if (change && change.cb) {
                await change.cb();
            }
        }
    },

    /**
     * Helper functions for querying changes
     */
    getChangesForLayer(todo: Record<string, PendingChange>, layer: number): PendingChange[] {
        return Object.values(todo).filter((change) => change.layer === layer);
    },

    getChangesByType(todo: Record<string, PendingChange>, type: PendingChange["type"]): PendingChange[] {
        return Object.values(todo).filter((change) => change.type === type);
    },

    hasPendingChangeForKey(todo: Record<string, PendingChange>, layer: number, row: number, col: number): boolean {
        return Object.values(todo).some((change) => change.type === "key" && change.layer === layer && change.row === row && change.col === col);
    },

    getPendingChangeForKey(todo: Record<string, PendingChange>, layer: number, row: number, col: number): PendingChange | null {
        return Object.values(todo).find((change) => change.type === "key" && change.layer === layer && change.row === row && change.col === col) || null;
    },
};

/**
 * Writes runs of keycodes in one message each (VIA dynamic keymap set-buffer).
 * Positions are keymap indexes, (layer * rows + row) * cols + col, the order of
 * the board's dynamic keymap.
 */
export interface KeyBlockWriter {
    layers: number;
    rows: number;
    cols: number;
    /** The most keycodes one write can carry. */
    maxKeys: number;
    /** Write `keycodes` to consecutive positions starting at keymap index `index`. */
    write(index: number, keycodes: number[]): Promise<void>;
}

/** VIA buffer offsets are 16-bit byte offsets: two bytes per keycode. */
const KEYMAP_BUFFER_KEYS = 0x8000;

/** A keymap position and keycode, when the change is a plain keycode write. */
function keyWrite(key: string, change: PendingChange, writer: KeyBlockWriter): { index: number; keycode: number } | null {
    const { layer, row, col, keycode } = change;
    if (change.type !== "key" || layer === undefined || row === undefined || col === undefined || keycode === undefined) return null;
    if (key !== `key:${layer}:${row}:${col}`) return null;
    if (![layer, row, col, keycode].every(Number.isInteger) || keycode < 0 || keycode > 0xffff) return null;
    if (layer < 0 || row < 0 || col < 0 || layer >= writer.layers || row >= writer.rows || col >= writer.cols) return null;
    const index = (layer * writer.rows + row) * writer.cols + col;
    return index < KEYMAP_BUFFER_KEYS ? { index, keycode } : null;
}

/**
 * The next block of key changes to write in one message, or null when the next
 * pending change isn't a keycode write. Only the key changes queued back to back
 * at the head are considered, so key writes never move past another kind of
 * change. Among those, the block is the run of consecutive positions starting at
 * the lowest one, capped at `maxKeys`. Gaps are never filled in: positions with
 * no pending change are left as the board has them.
 */
function nextKeyBlock(pending: Record<string, PendingChange>, writer: KeyBlockWriter) {
    const candidates: Array<{ key: string; change: PendingChange; index: number; keycode: number }> = [];
    for (const [key, change] of Object.entries(pending)) {
        const write = keyWrite(key, change, writer);
        if (!write) break;
        candidates.push({ key, change, ...write });
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => a.index - b.index);
    const block = [candidates[0]];
    for (let i = 1; i < candidates.length && block.length < writer.maxKeys; i++) {
        if (candidates[i].index !== block[block.length - 1].index + 1) break;
        block.push(candidates[i]);
    }
    return block;
}

/**
 * Serial, revision-aware write queue. Failed entries and later edits remain retryable.
 * With a key block writer, keycode changes are written a block at a time; a block
 * that fails leaves exactly its keys pending.
 */
export class ChangeQueue {
    pending: Record<string, PendingChange> = {};
    isSaving = false;
    error: string | null = null;
    private generation = 0;
    private suspended = false;
    private active: Promise<boolean> | null = null;
    constructor(private notify: () => void, private canWrite: () => boolean = () => true, private captureSave?: () => (() => void), private keyWriter?: () => KeyBlockWriter | null) {}

    add(desc: string, cb: () => Promise<void>, metadata: Partial<PendingChange> = {}) {
        const key = metadata.writeKey || desc;
        this.pending = { ...this.pending, [key]: { ...metadata, desc, cb, timestamp: Date.now(), type: metadata.type || "key" } };
        this.notify();
    }
    clear(key: string) {
        if (this.isSaving) return;
        const next = { ...this.pending };
        delete next[key];
        this.pending = next;
        this.notify();
    }
    reset() {
        this.generation++;
        this.pending = {};
        this.error = null;
        this.notify();
    }
    async suspendAndDrain(): Promise<(discardPending?: boolean) => void> {
        this.suspended = true;
        if (this.active) await this.active;
        return (discardPending = false) => {
            if (discardPending) this.reset();
            this.suspended = false;
        };
    }
    commit(): Promise<boolean> {
        if (this.suspended) return Promise.resolve(false);
        if (this.active) return this.active;
        if (!Object.keys(this.pending).length) return Promise.resolve(true);
        this.isSaving = true;
        this.error = null;
        const generation = this.generation;
        this.notify();
        this.active = Promise.resolve().then(async () => {
            let acknowledge: (() => void) | undefined;
            try {
                while (generation === this.generation && Object.keys(this.pending).length) {
                    if (this.suspended) return false;
                    if (!this.canWrite()) throw new Error("Keyboard disconnected. Reconnect before applying changes.");
                    const writer = this.keyWriter?.();
                    const block = writer && writer.maxKeys > 0 ? nextKeyBlock(this.pending, writer) : null;
                    const written: Array<[string, PendingChange]> = block
                        ? block.map(({ key, change }) => [key, change])
                        : [Object.entries(this.pending)[0]];
                    acknowledge = this.captureSave?.();
                    if (block) await writer!.write(block[0].index, block.map(({ keycode }) => keycode));
                    else await written[0][1].cb();
                    if (!this.canWrite()) throw new Error("Keyboard disconnected before the save could be confirmed.");
                    if (generation !== this.generation) return false;
                    // Do not erase a newer edit queued while this write was in flight.
                    const next = { ...this.pending };
                    for (const [key, change] of written) {
                        if (next[key] === change) delete next[key];
                    }
                    this.pending = next;
                    this.notify();
                }
                if (generation === this.generation) acknowledge?.();
                return generation === this.generation;
            } catch (error) {
                if (generation === this.generation) {
                    this.error = error instanceof Error ? error.message : String(error);
                }
                return false;
            } finally {
                this.isSaving = false;
                this.active = null;
                this.notify();
            }
        });
        return this.active;
    }
}
