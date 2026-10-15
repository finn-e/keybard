// The install flow: one confirm, then hands off (update-flow 5, protocol contract 2.8).
//
// The state lives outside the connection, in sessionStorage, so the dialog survives the
// keyboard's restart and a reload. Every screen is a pure function of this state.
//
// Rules this file enforces:
// - The chord is asked for at most once per update. A pair update asks for it at the
//   other half's pair ARM; the half with USB then installs on the held approval. If the
//   approval isn't there, the flow stops on F9 ("Halves differ") instead of asking again.
// - Every install backs up first; the Afterwards choice is acted on with no prompt.
// - 0x2A (clear the reset notice) is sent last, after the restore or the defaults.

import { UpdaterClient, UpdaterStatusError } from "./client";
import type { Plan, Target } from "./checks";
import {
    ARM_MODE_PAIR, ARM_MODE_SINGLE, CHUNK_PIECE_MAX, HAND_SELF, Presence, RelayPhase, SETTINGS_RESET_BOTH, State, Status,
    handName, hex, otherHand, type Hand,
} from "./protocol";
import { loadSvup, type SvupFile } from "./svup";
import { DisconnectedError, ReplyTimeoutError, type Clock, type UpdaterTransport } from "./transport";

export type Afterwards = "restore" | "defaults";

export type Stage =
    | "waiting" | "approve" | "preparing" | "sending" | "checking" | "copying" | "installing" | "restarting"
    | "reconnecting" | "checking-halves" | "restoring" | "done" | "stopped";

export type Step =
    | "start" | "approve" | "other-erase" | "other-send" | "other-verify" | "relay" | "other-install" | "other-restart"
    | "self-arm" | "self-erase" | "self-send" | "self-verify" | "self-install" | "reconnect" | "check-halves"
    | "settings-reset" | "restore" | "done" | "failed";

export type FailureId = "F2" | "F3" | "F4" | "F5" | "F6" | "F9" | "F10" | "F11" | "F12" | "F14" | "F16" | "F17" | "F18" | "F19";

export interface Failure {
    id: FailureId;
    /** Which half a manual install is for (F10, F11). */
    hand?: Hand;
    /** What each half runs now, when known (F5, F9). */
    tags?: Partial<Record<Hand, string>>;
    detail?: string;
}

export interface RowState {
    hand: Hand;
    usb: boolean;
    stage: Stage;
    /** 0..1, or null for an indeterminate bar. */
    progress: number | null;
    fromTag: string;
    toTag: string;
}

export interface FlowFileRef {
    hand: Hand;
    name: string;
    sha256: string;
    tag: string;
    fwVersion: number;
}

export interface FlowResult {
    tags: Partial<Record<Hand, string>>;
    layout: "restored" | "defaults";
    /** Lines the import preflight trimmed, e.g. "Combos: 6 of 8 (this firmware has 6)". */
    trimmed: string[];
}

export interface FlowState {
    version: 1;
    id: string;
    phase: "running" | "result" | "failed" | "cancelled";
    target: Target;
    usbHand: Hand;
    title: string;
    toTag: string;
    fromTag: string;
    files: Partial<Record<Hand, FlowFileRef>>;
    afterwards: Afterwards;
    backup: { snapshotId?: string; fileName: string } | null;
    /** The board installs without the chord (INFO flags bit7). */
    noChord: boolean;
    step: Step;
    stepAt: number;
    /** When the approval step began (for the 30 s countdown). */
    approveAt: number | null;
    rows: RowState[];
    /** COMMIT accepted: the point of no return for that half. */
    committed: Hand[];
    halvesDone: Hand[];
    /** Times the user was asked for the chord in this update. Never more than 1. */
    approvalsAsked: number;
    settingsResetSent: boolean;
    sent2A: boolean;
    startedAt: number;
    finishedAt: number | null;
    result: FlowResult | null;
    failure: Failure | null;
    /** WebHID round trips and stage times, for update-technical.md 1.9. */
    measurements: Record<string, number>;
}

/** What the flow needs from the app (or the mock): the connection, the layout, backups. */
export interface FlowHost {
    clock: Clock;
    /** The open connection, or null. */
    transport(): UpdaterTransport | null;
    /** Wait for the keyboard to come back after a restart and reopen it (same product ID: no chooser). */
    waitForDevice(timeoutMs: number): Promise<UpdaterTransport | null>;
    /** Sval GET_INFO storage flags of the connection (bit 1 writes failing, bit 2 reset by a new build). */
    readStorageFlags(): Promise<number>;
    /** 0x2A: the reset notice was acted on. */
    clearStorageReset(): Promise<void>;
    /** Put the backup back through the import path; returns what the preflight trimmed. */
    restoreLayout(svil: string): Promise<{ trimmed: string[] }>;
    /** Hold a Web Lock and a Screen Wake Lock for the update; returns their release. */
    holdLocks?(): Promise<() => void>;
}

export interface FlowStore {
    load(): { state: FlowState; files: Partial<Record<Hand, Uint8Array>>; backupSvil: string | null } | null;
    save(state: FlowState): void;
    saveFiles(files: Partial<Record<Hand, Uint8Array>>, backupSvil: string | null): void;
    clear(): void;
}

const KEY = "keybard:firmware-update";

function toB64(bytes: Uint8Array): string {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
}

function fromB64(text: string): Uint8Array {
    const s = atob(text);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
}

/** The flow state in sessionStorage: per tab, survives a reload, gone with the tab. */
export function sessionFlowStore(storage: Storage | null = typeof sessionStorage === "undefined" ? null : sessionStorage): FlowStore {
    const get = (k: string) => { try { return storage?.getItem(k) ?? null; } catch { return null; } };
    const set = (k: string, v: string) => { try { storage?.setItem(k, v); } catch (e) { console.warn("[firmware] couldn't save the update state", e); } };
    const del = (k: string) => { try { storage?.removeItem(k); } catch { /* nothing to do */ } };
    return {
        load() {
            const raw = get(KEY);
            if (!raw) return null;
            try {
                const state = JSON.parse(raw) as FlowState;
                const filesRaw = JSON.parse(get(`${KEY}:files`) ?? "{}") as Partial<Record<Hand, string>>;
                const files: Partial<Record<Hand, Uint8Array>> = {};
                for (const h of [0, 1] as Hand[]) if (filesRaw[h]) files[h] = fromB64(filesRaw[h]!);
                return { state, files, backupSvil: get(`${KEY}:backup`) };
            } catch { return null; }
        },
        save(state) { set(KEY, JSON.stringify(state)); },
        saveFiles(files, backupSvil) {
            const raw: Partial<Record<Hand, string>> = {};
            for (const h of [0, 1] as Hand[]) if (files[h]) raw[h] = toB64(files[h]!);
            set(`${KEY}:files`, JSON.stringify(raw));
            if (backupSvil !== null) set(`${KEY}:backup`, backupSvil);
        },
        clear() { del(KEY); del(`${KEY}:files`); del(`${KEY}:backup`); },
    };
}

/** Whether this tab has an update in flight (the flow owns any reset notice then). */
export function updateInFlight(store: FlowStore = sessionFlowStore()): boolean {
    const saved = store.load();
    return !!saved && saved.state.phase === "running";
}

export function memoryFlowStore(): FlowStore & { snapshot: string | null } {
    let state: string | null = null;
    let files: Partial<Record<Hand, Uint8Array>> = {};
    let backup: string | null = null;
    return {
        get snapshot() { return state; },
        load() { return state ? { state: JSON.parse(state) as FlowState, files, backupSvil: backup } : null; },
        save(s) { state = JSON.stringify(s); },
        saveFiles(f, b) { files = f; if (b !== null) backup = b; },
        clear() { state = null; files = {}; backup = null; },
    };
}

/** The user cancelled before the first install. */
class Cancelled extends Error {}

/** Stops the flow with a failure screen. */
class Stop extends Error {
    constructor(readonly failure: Failure) {
        super(failure.id);
    }
}

const POLL_MS = 250;
const CHORD_WAIT_MS = 35_000;
const RECONNECT_MS = 30_000;
const PRESENCE_MS = 10_000;

export interface StartInput {
    plan: Plan;
    afterwards: Afterwards;
    backup: { snapshotId?: string; fileName: string; svil: string } | null;
}

export class UpdateFlow {
    state: FlowState;
    private files: Partial<Record<Hand, SvupFile>> = {};
    private backupSvil: string | null = null;
    private listeners = new Set<(s: FlowState) => void>();
    private client: UpdaterClient | null = null;
    private running = false;
    private cancelRequested = false;

    /** Whether Cancel is still offered: until the first install starts. */
    get cancellable(): boolean {
        return this.state.phase === "running" && this.state.committed.length === 0 && !this.cancelRequested;
    }

    /** Stop before the first install; the board is told to ABORT. */
    cancel(): void {
        if (this.cancellable) this.cancelRequested = true;
    }

    private checkCancel() {
        if (this.cancelRequested && this.state.committed.length === 0) throw new Cancelled();
    }

    private constructor(private host: FlowHost, private store: FlowStore, state: FlowState) {
        this.state = state;
    }

    /** A new update from the sheet's plan. Nothing is sent until run(). */
    static create(host: FlowHost, store: FlowStore, input: StartInput): UpdateFlow {
        const { plan } = input;
        const usbHand = plan.board.usb.hand as Hand;
        const halves: Hand[] = plan.target === "both" ? [otherHand(usbHand), usbHand] : [plan.target];
        const files: Partial<Record<Hand, FlowFileRef>> = {};
        for (const h of halves) {
            const f = plan.files[h]!;
            files[h] = { hand: h, name: `${handName(h)}-${f.manifest.tag || "firmware"}.svup`, sha256: f.sha256, tag: f.manifest.tag, fwVersion: f.manifest.fwVersion };
        }
        // INFO page 1 (the tag) is this half's only; name the other half by its build when it differs.
        const other = plan.board.other;
        const otherTag = other && other.fwVersion !== plan.board.usb.fwVersion ? `build ${other.fwVersion}` : plan.fromTag;
        const now = host.clock.now();
        const state: FlowState = {
            version: 1,
            id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
            phase: "running",
            target: plan.target,
            usbHand,
            title: plan.title,
            toTag: plan.toTag,
            fromTag: plan.fromTag,
            files,
            afterwards: input.backup ? input.afterwards : "defaults",
            backup: input.backup ? { snapshotId: input.backup.snapshotId, fileName: input.backup.fileName } : null,
            noChord: plan.board.noChord,
            step: "start",
            stepAt: now,
            approveAt: null,
            rows: halves.map((h) => ({ hand: h, usb: h === usbHand, stage: "waiting", progress: 0, fromTag: h === usbHand ? plan.fromTag : otherTag, toTag: files[h]!.tag })),
            committed: [],
            halvesDone: [],
            approvalsAsked: 0,
            settingsResetSent: false,
            sent2A: false,
            startedAt: now,
            finishedAt: null,
            result: null,
            failure: null,
            measurements: {},
        };
        const flow = new UpdateFlow(host, store, state);
        flow.files = plan.files;
        flow.backupSvil = input.backup?.svil ?? null;
        const bytes: Partial<Record<Hand, Uint8Array>> = {};
        for (const h of halves) bytes[h] = plan.files[h]!.bytes;
        store.saveFiles(bytes, flow.backupSvil);
        store.save(state);
        return flow;
    }

    /** The update this tab had in flight before a reload, if any. */
    static async restore(host: FlowHost, store: FlowStore): Promise<UpdateFlow | null> {
        const saved = store.load();
        if (!saved) return null;
        const flow = new UpdateFlow(host, store, saved.state);
        for (const h of [0, 1] as Hand[]) if (saved.files[h]) flow.files[h] = await loadSvup(saved.files[h]!);
        flow.backupSvil = saved.backupSvil;
        return flow;
    }

    subscribe(listener: (s: FlowState) => void): () => void {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }

    private update(patch: Partial<FlowState>) {
        this.state = { ...this.state, ...patch };
        this.store.save(this.state);
        for (const l of [...this.listeners]) l(this.state);
    }

    private row(hand: Hand, patch: Partial<RowState>) {
        this.update({ rows: this.state.rows.map((r) => (r.hand === hand ? { ...r, ...patch } : r)) });
    }

    private step(step: Step) {
        this.checkCancel();
        this.update({ step, stepAt: this.host.clock.now() });
    }

    /** Forget the update (after Done, Close, or a failure the user dismissed). */
    dismiss() {
        this.store.clear();
    }

    private now() {
        return this.host.clock.now();
    }

    private connection(): UpdaterClient {
        const t = this.host.transport();
        if (!t || !t.connected()) throw new DisconnectedError();
        if (!this.client || this.client.transport !== t) {
            const previous = this.client;
            this.client = new UpdaterClient(t);
            if (previous?.tracking != null) this.client.track(previous.tracking, this.state.usbHand);
        }
        return this.client;
    }

    // ---- run ----------------------------------------------------------------------------------

    /**
     * Run from wherever the state is. A fresh flow installs; a restored one resumes
     * after the restart, or reports that it didn't finish (F6).
     */
    async run(): Promise<FlowState> {
        if (this.running) return this.state;
        this.running = true;
        const release = await this.host.holdLocks?.().catch(() => undefined);
        try {
            if (this.state.phase !== "running") return this.state;
            if (this.state.step === "start") await this.install();
            else await this.resume();
            await this.after();
        } catch (error) {
            if (error instanceof Cancelled) {
                await this.abortQuietly();
                this.update({ phase: "cancelled", step: "failed", finishedAt: this.now() });
                this.store.clear();
                return this.state;
            }
            const failure = error instanceof Stop ? error.failure : this.unexpected(error);
            await this.abortQuietly();
            this.update({ phase: "failed", step: "failed", failure, finishedAt: this.now(), rows: this.state.rows.map((r) => (r.stage === "done" ? r : { ...r, stage: "stopped", progress: null })) });
        } finally {
            release?.();
            this.running = false;
        }
        return this.state;
    }

    private unexpected(error: unknown): Failure {
        console.warn("[firmware] update stopped", error);
        const o = otherHand(this.state.usbHand);
        if (this.state.committed.includes(o) && !this.state.committed.includes(this.state.usbHand)) return this.halvesDiffer();
        if (error instanceof UpdaterStatusError && (error.status === Status.OTHER_CLIENT || error.status === Status.BUSY)) return { id: "F3" };
        if (error instanceof UpdaterStatusError && error.status === Status.NOT_CONFIRMED) return { id: "F4" };
        if (error instanceof UpdaterStatusError && error.status === Status.UNAVAILABLE && this.state.target === "both") return { id: "F5", tags: this.fromTags(), detail: "The other half stopped answering." };
        return { id: "F5", tags: this.fromTags(), detail: error instanceof Error ? error.message : String(error) };
    }

    private fromTags(): Partial<Record<Hand, string>> {
        const out: Partial<Record<Hand, string>> = {};
        for (const r of this.state.rows) out[r.hand] = r.fromTag;
        return out;
    }

    private halvesDiffer(): Failure {
        const tags = this.fromTags();
        for (const h of this.state.committed) tags[h] = this.state.files[h]?.tag;
        return { id: "F9", tags };
    }

    private async abortQuietly() {
        const c = this.client;
        if (!c || c.tracking === null || this.state.committed.includes(this.state.usbHand)) return;
        try {
            const t = this.host.transport();
            if (t?.connected()) await c.abort(this.sessionHand ?? this.state.usbHand, c.tracking ?? 0);
        } catch { /* the board may be gone; its own timeout clears it */ }
    }

    private sessionHand: Hand | null = null;

    private async install() {
        const { target, usbHand } = this.state;
        const oHand = otherHand(usbHand);
        if (target === "both" || target === oHand) await this.installOther(target === "both");
        if (target === "both" || target === usbHand) await this.installUsb(target === "both");
    }

    /** Poll STATUS until `until` holds; an ERROR latched on the board ends the poll. */
    private async poll<T extends { state: number; lastError: number }>(read: () => Promise<T>, until: (s: T) => boolean, timeoutMs: number, onTick?: (s: T) => void): Promise<T> {
        const deadline = this.now() + timeoutMs;
        for (;;) {
            const s = await read();
            onTick?.(s);
            if (s.state === State.ERROR) throw new UpdaterStatusError("STATUS", s.lastError, s.state);
            if (until(s)) return s;
            this.checkCancel();
            if (this.now() >= deadline) throw new UpdaterStatusError("STATUS", Status.TIMEOUT, s.state);
            await this.host.clock.sleep(POLL_MS);
        }
    }

    private async waitForChord(c: UpdaterClient, hand: Hand) {
        this.update({ approvalsAsked: this.state.approvalsAsked + 1, approveAt: this.now() });
        this.step("approve");
        for (const r of this.state.rows) this.row(r.hand, { stage: "approve", progress: null });
        try {
            await this.poll(() => c.status(hand), (s) => s.chordMade, CHORD_WAIT_MS);
        } catch (error) {
            if (error instanceof UpdaterStatusError && (error.status === Status.NOT_CONFIRMED || error.status === Status.TIMEOUT)) throw new Stop({ id: "F4" });
            throw error;
        }
        for (const r of this.state.rows) this.row(r.hand, { stage: "waiting", progress: 0 });
    }

    /** BEGIN, erase, CHUNKs, END, verify and the CRC check, for one session. */
    private async transfer(c: UpdaterClient, hand: Hand, nonce: number, file: SvupFile, steps: { erase: Step; send: Step; verify: Step }) {
        this.step(steps.erase);
        this.row(hand, { stage: "preparing", progress: 0 });
        await c.begin(hand, nonce);
        await this.poll(() => c.status(hand), (s) => s.state === State.RECEIVING, 120_000, (s) => {
            if (s.sectorsToErase) this.row(hand, { progress: s.sectorsErased / s.sectorsToErase });
        });
        this.step(steps.send);
        const t0 = this.now();
        const image = file.image;
        let off = 0;
        let lastShown = -1;
        this.row(hand, { stage: "sending", progress: 0 });
        while (off < image.length) {
            const n = Math.min(CHUNK_PIECE_MAX, image.length - off);
            const { status, next } = await c.chunk(hand, off, image.subarray(off, off + n));
            if (status === Status.OK) off = next;
            else if (status === Status.OUT_OF_ORDER && next <= image.length) off = next;
            else throw new UpdaterStatusError("CHUNK", status);
            this.checkCancel();
            const pct = Math.floor((off / image.length) * 100);
            if (pct !== lastShown) { lastShown = pct; this.row(hand, { progress: off / image.length }); }
        }
        this.update({ measurements: { ...this.state.measurements, [`send_${handName(hand)}_ms`]: this.now() - t0 } });
        this.step(steps.verify);
        this.row(hand, { stage: "checking", progress: null });
        await c.end(hand, nonce);
        const s = await this.poll(() => c.status(hand), (st) => st.state === State.VERIFIED, 60_000);
        if (s.crcLo16 !== (file.crcBody & 0xffff)) throw new Stop({ id: "F5", tags: this.fromTags(), detail: "The keyboard's copy doesn't match the file." });
    }

    private checkArmHash(got: Uint8Array, file: SvupFile) {
        if (hex(got) !== hex(file.manifestSha512.subarray(0, 4))) throw new Stop({ id: "F5", tags: this.fromTags(), detail: "The keyboard received a different manifest." });
    }

    private async installOther(pair: boolean) {
        const usbHand = this.state.usbHand;
        const o = otherHand(usbHand);
        const c = this.connection();
        const fileO = this.files[o]!;
        this.sessionHand = o;
        await c.loadManifest(o, fileO.manifestBytes);
        if (pair) await c.loadManifest(usbHand, this.files[usbHand]!.manifestBytes, true);
        const arm = await c.arm(o, pair ? ARM_MODE_PAIR : ARM_MODE_SINGLE);
        this.checkArmHash(arm.manifestHash, fileO);
        if (pair) this.checkArmHash(arm.pairHash, this.files[usbHand]!);
        if (!arm.preApproved) await this.waitForChord(c, o);
        await this.transfer(c, o, arm.nonce, fileO, { erase: "other-erase", send: "other-send", verify: "other-verify" });

        // COMMIT #1: the copy over the split cable.
        this.step("relay");
        this.row(o, { stage: "copying", progress: 0 });
        await c.commit(o, arm.nonce, fileO.crcBody & 0xffff);
        const t0 = this.now();
        await this.poll(async () => { const r = await c.relay(o); return { ...r, lastError: r.error }; }, (r) => r.state === State.RELAYED, 180_000, (r) => {
            if (r.phase === RelayPhase.PAGES && r.imageLen) this.row(o, { progress: r.acked / r.imageLen });
        });
        this.update({ measurements: { ...this.state.measurements, relay_ms: this.now() - t0 } });

        // COMMIT #2: the other half installs. From here it runs the new release.
        await c.commit(o, arm.nonce, fileO.crcBody & 0xffff);
        this.update({ committed: [...this.state.committed, o] });
        this.step("other-install");
        this.row(o, { stage: "installing", progress: null });
        if (pair) c.track(arm.nonce, usbHand); // keep REBINDing the held approval
        else c.untrack();
        await this.poll(() => c.status(usbHand), (s) => s.state === State.IDLE, 30_000);
        this.step("other-restart");
        this.row(o, { stage: "restarting", progress: null });
        const answered = await this.waitOtherAnswers(c, o);
        this.row(o, { stage: answered ? "done" : "restarting", progress: answered ? 1 : null });
        this.update({ halvesDone: answered ? [...this.state.halvesDone, o] : this.state.halvesDone });
        this.sessionHand = null;
        if (!pair) {
            if (!answered) throw new Stop({ id: "F11", hand: o });
            // A one-half update of the other half: no restart of the half with USB.
            this.step("check-halves");
        }
    }

    private async waitOtherAnswers(c: UpdaterClient, o: Hand): Promise<boolean> {
        const deadline = this.now() + PRESENCE_MS;
        while (this.now() < deadline) {
            const info = await c.info(o).catch(() => null);
            if (info?.answered) return true;
            await this.host.clock.sleep(500);
        }
        return false;
    }

    private async installUsb(pair: boolean) {
        const usbHand = this.state.usbHand;
        const c = this.connection();
        const file = this.files[usbHand]!;
        this.step("self-arm");
        this.sessionHand = usbHand;
        if (pair) {
            // The held approval must be there: otherwise stop, never ask for the chord again.
            const st = await c.status(usbHand);
            if (!st.approvalHeld) throw new Stop(this.halvesDiffer());
        }
        await c.loadManifest(usbHand, file.manifestBytes);
        const arm = await c.arm(usbHand, ARM_MODE_SINGLE);
        this.checkArmHash(arm.manifestHash, file);
        if (!arm.preApproved) {
            if (pair || this.state.approvalsAsked > 0) throw new Stop(this.halvesDiffer());
            await this.waitForChord(c, usbHand);
        }
        await this.transfer(c, usbHand, arm.nonce, file, { erase: "self-erase", send: "self-send", verify: "self-verify" });
        await c.commit(usbHand, arm.nonce, file.crcBody & 0xffff);
        c.untrack();
        this.sessionHand = null;
        this.update({ committed: [...this.state.committed, usbHand] });
        this.step("self-install");
        this.row(usbHand, { stage: "installing", progress: null });
        await this.reconnect();
    }

    private async reconnect() {
        const usbHand = this.state.usbHand;
        this.step("reconnect");
        this.row(usbHand, { stage: "restarting", progress: null });
        // Give the old connection time to drop (COMMIT to reboot: 1-2 s).
        const gone = this.now() + 5000;
        while (this.host.transport()?.connected() && this.now() < gone) await this.host.clock.sleep(POLL_MS);
        const t0 = this.now();
        const t = await this.host.waitForDevice(RECONNECT_MS);
        if (!t) throw new Stop({ id: "F14", hand: usbHand });
        this.update({ measurements: { ...this.state.measurements, reconnect_ms: this.now() - t0 } });
        this.row(usbHand, { stage: "reconnecting", progress: null });
        this.client = new UpdaterClient(t);
    }

    /** After a reload: pick up after the restart, or say the update didn't finish. */
    private async resume() {
        const { step, usbHand, target } = this.state;
        const after: Step[] = ["self-install", "reconnect", "check-halves", "settings-reset", "restore"];
        if (this.state.committed.includes(usbHand) || (target !== "both" && target !== usbHand && this.state.committed.length)) {
            if (step === "self-install" || step === "reconnect") {
                const t = this.host.transport();
                if (!t?.connected()) await this.reconnect();
            }
            return;
        }
        if (after.includes(step)) return;
        // Mid-install when the tab went away: the board's session timed out by itself.
        if (this.state.committed.length) throw new Stop({ ...this.halvesDiffer(), id: "F9" });
        throw new Stop({ id: "F6", tags: this.fromTags() });
    }

    /** Both halves' versions and presence, then the Afterwards choice, then 0x2A. */
    private async after() {
        const { usbHand, target } = this.state;
        const o = otherHand(usbHand);
        this.step("check-halves");
        let c = this.connection();
        const usbRow = this.state.rows.find((r) => r.usb);
        if (usbRow) this.row(usbHand, { stage: "checking-halves", progress: null });
        const info = await c.info(HAND_SELF);
        const tags: Partial<Record<Hand, string>> = {};
        const page1 = await c.info1();
        tags[usbHand] = page1.tag;
        const wantUsb = this.state.files[usbHand];
        if (wantUsb && (info.fwVersion !== wantUsb.fwVersion)) throw new Stop({ id: "F5", tags: { [usbHand]: page1.tag } as Partial<Record<Hand, string>>, detail: "The keyboard still runs its old firmware." });
        // Presence MATCH within 10 s; the other half's version from its INFO.
        const deadline = this.now() + PRESENCE_MS;
        let presence = (await c.status(usbHand)).presence;
        while (presence !== Presence.MATCH && this.now() < deadline) {
            await this.host.clock.sleep(500);
            presence = (await c.status(usbHand)).presence;
        }
        const oInfo = await c.info(o).catch(() => null);
        if (!oInfo?.answered) {
            if (target === "both" || target === o) throw new Stop({ id: "F11", hand: o });
        }
        const wantO = this.state.files[o];
        tags[o] = wantO && oInfo?.fwVersion === wantO.fwVersion ? wantO.tag : oInfo?.fwVersion === info.fwVersion ? page1.tag : undefined;
        if (presence !== Presence.MATCH) {
            const differ = { ...tags };
            if (!differ[o]) differ[o] = this.state.rows.find((r) => r.hand === o)?.fromTag;
            throw new Stop({ id: "F9", tags: differ });
        }
        for (const r of this.state.rows) this.row(r.hand, { stage: r.usb ? "checking-halves" : "done", progress: r.usb ? null : 1 });
        this.update({ halvesDone: [...new Set([...this.state.halvesDone, ...this.state.rows.map((r) => r.hand)])] });

        // Afterwards, as chosen on the sheet, with no prompt.
        let flags = await this.host.readStorageFlags();
        if (flags & 0x02) throw new Stop({ id: "F17" });
        let trimmed: string[] = [];
        if (this.state.afterwards === "restore" && this.backupSvil) {
            this.step("restore");
            this.row(usbHand, { stage: "restoring", progress: null });
            try {
                trimmed = (await this.host.restoreLayout(this.backupSvil)).trimmed;
            } catch (error) {
                throw new Stop({ id: "F16", detail: error instanceof Error ? error.message : String(error) });
            }
        } else if (!this.state.settingsResetSent && (!(flags & 0x04) || target !== "both")) {
            // An identical build kept the old settings, or only one half was installed: reset both (F-N2).
            this.step("settings-reset");
            this.row(usbHand, { stage: "restarting", progress: null });
            const r = await c.settingsReset(usbHand, SETTINGS_RESET_BOTH);
            if (r.status !== Status.OK) throw new Stop({ id: "F16", detail: `The keyboard couldn't reset its settings (${r.status === Status.UNAVAILABLE ? "the other half didn't answer" : "busy"}).` });
            this.update({ settingsResetSent: true });
            await this.reconnect();
            c = this.connection();
            flags = await this.host.readStorageFlags();
            if (!(flags & 0x04)) console.warn("[firmware] settings reset, but the reset notice isn't set");
        }
        // Last: tell the board the reset was acted on.
        await this.host.clearStorageReset();
        this.update({ sent2A: true });
        for (const r of this.state.rows) this.row(r.hand, { stage: "done", progress: 1 });
        this.update({
            phase: "result",
            step: "done",
            finishedAt: this.now(),
            result: { tags, layout: this.state.afterwards === "restore" && this.backupSvil ? "restored" : "defaults", trimmed },
        });
    }
}

/** A disconnect or timeout, as opposed to a refusal: used by the UI to word F5. */
export const isConnectionLoss = (error: unknown) => error instanceof DisconnectedError || error instanceof ReplyTimeoutError;
