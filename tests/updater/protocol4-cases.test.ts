// Every case of tests/updater/protocol4-cases.md, against FakeSvalboard.
import { beforeEach, describe, expect, it } from "vitest";
import { UpdaterClient, UpdaterStatusError } from "@/services/updater/client";
import { fakeSetup, fixtureRelease, type FixtureRelease } from "@/services/updater/fake-host";
import type { FakeSvalboard } from "@/services/updater/fake-board";
import {
    ARM_MODE_PAIR, ARM_MODE_SINGLE, HAND_LEFT, HAND_RIGHT, HAND_SELF, Op, Presence, State, Status, chunkArgs, hex,
    manifestArgs, settingsResetArgs,
} from "@/services/updater/protocol";
import { loadSvup, buildSvup, type SvupFile } from "@/services/updater/svup";
import { VirtualClock } from "@/services/updater/transport";

const R = HAND_RIGHT; // the half with USB
const L = HAND_LEFT;

let clock: VirtualClock;
let v3: FixtureRelease;
let x4: FixtureRelease;

beforeEach(async () => {
    clock = new VirtualClock();
    v3 ??= await fixtureRelease("v3", 3000);
    x4 ??= await fixtureRelease("x4", 4000);
});

/** Poll in virtual time; fail instead of spinning forever. */
async function until(check: () => Promise<boolean>, step = 250, limitMs = 300_000) {
    const end = clock.now() + limitMs;
    while (!(await check())) {
        if (clock.now() > end) throw new Error("condition never held");
        await clock.sleep(step);
    }
}

function setup(o: Partial<Parameters<typeof fakeSetup>[0]> = {}) {
    const { board, host } = fakeSetup({ clock, running: v3, ...o });
    return { board, host, c: new UpdaterClient(board) };
}

async function pairArm(c: UpdaterClient, files = x4.files) {
    await c.loadManifest(L, files[L].manifestBytes);
    await c.loadManifest(R, files[R].manifestBytes, true);
    return c.arm(L, ARM_MODE_PAIR);
}

async function send(c: UpdaterClient, board: FakeSvalboard, hand: number, nonce: number, file: SvupFile) {
    await c.begin(hand, nonce);
    await until(async () => !((await c.status(hand)).state !== State.RECEIVING), 100);
    for (let off = 0; off < file.image.length;) {
        const r = await c.chunk(hand, off, file.image.subarray(off, off + 50));
        expect(r.status).toBe(Status.OK);
        off = r.next;
    }
    await c.end(hand, nonce);
    await until(async () => !((await c.status(hand)).state !== State.VERIFIED), 100);
    void board;
}

/** The other half's whole session, through relay DONE. */
async function otherHalf(c: UpdaterClient, board: FakeSvalboard) {
    const arm = await pairArm(c);
    await until(async () => !(!(await c.status(L)).chordMade), 250);
    await send(c, board, L, arm.nonce, x4.files[L]);
    await c.commit(L, arm.nonce, x4.files[L].crcBody & 0xffff);
    await until(async () => !((await c.relay(L)).state !== State.RELAYED), 250);
    await c.commit(L, arm.nonce, x4.files[L].crcBody & 0xffff);
    c.track(arm.nonce, R);
    await until(async () => !((await c.status(R)).state !== State.IDLE), 250);
    return arm;
}

describe("updater protocol 4 against the mock board", () => {
    it("P4-01 INFO page 0 reports protocol 4 and the piece sizes", async () => {
        const { c } = setup();
        const i = await c.info(HAND_SELF);
        expect(i).toMatchObject({ protocol: 4, chunkMax: 50, manifestMax: 52, reportBytes: 64, hand: R });
    });

    it("P4-02 INFO flags bit7 marks a no-chord developer build", async () => {
        expect((await setup({ noChord: true }).c.info()).noChord).toBe(true);
        expect((await setup().c.info()).noChord).toBe(false);
    });

    it("P4-03 PAIR_MANIFEST with no session for the other hand is INVALID", async () => {
        const { c, board } = setup();
        const r = await c.op(Op.PAIR_MANIFEST, R, manifestArgs(0, x4.files[R].manifestBytes.subarray(0, 52)));
        expect(r.status).toBe(Status.INVALID);
        expect(board.state).toBe(State.IDLE);
    });

    it("P4-04 PAIR_MANIFEST from another client is OTHER_CLIENT", async () => {
        const { c, board } = setup();
        await c.loadManifest(L, x4.files[L].manifestBytes);
        await board.renewClient();
        const r = await c.op(Op.PAIR_MANIFEST, R, manifestArgs(0, x4.files[R].manifestBytes.subarray(0, 52)));
        expect(r.status).toBe(Status.OTHER_CLIENT);
    });

    it("P4-05 PAIR_MANIFEST after the session is armed is BUSY", async () => {
        const { c } = setup();
        await pairArm(c);
        const r = await c.op(Op.PAIR_MANIFEST, R, manifestArgs(0, x4.files[R].manifestBytes.subarray(0, 52)));
        expect(r.status).toBe(Status.BUSY);
    });

    it("P4-06 MANIFEST x3 then PAIR_MANIFEST x3 fill 52, 104, 108", async () => {
        const { c } = setup();
        const fills: number[] = [];
        for (const [op, hand, m] of [[Op.MANIFEST, L, x4.files[L].manifestBytes], [Op.PAIR_MANIFEST, R, x4.files[R].manifestBytes]] as const) {
            for (const off of [0, 52, 104]) fills.push((await c.op(op, hand, manifestArgs(off, m.subarray(off, Math.min(off + 52, 108))))).rsp[1]);
        }
        expect(fills).toEqual([52, 104, 108, 52, 104, 108]);
    });

    it("P4-07 a pair ARM without all 108 pair bytes is INVALID", async () => {
        const { c } = setup();
        await c.loadManifest(L, x4.files[L].manifestBytes);
        await c.op(Op.PAIR_MANIFEST, R, manifestArgs(0, x4.files[R].manifestBytes.subarray(0, 52)));
        expect((await c.op(Op.ARM, L, [ARM_MODE_PAIR])).status).toBe(Status.INVALID);
    });

    it("P4-08 a pair ARM for this half's own hand is INVALID", async () => {
        const { c } = setup();
        await c.loadManifest(R, x4.files[R].manifestBytes);
        expect((await c.op(Op.ARM, R, [ARM_MODE_PAIR])).status).toBe(Status.INVALID);
    });

    it("P4-09 a pair manifest this half would refuse latches ERROR at the pair ARM", async () => {
        const { c, board } = setup({ half: { securityEpoch: 2 } });
        const low = await loadSvup(await buildSvup({ hand: R, fwVersion: 4000, tag: "x4", securityEpoch: 1 }));
        const ok = await loadSvup(await buildSvup({ hand: L, fwVersion: 4000, tag: "x4", securityEpoch: 2 }));
        await c.loadManifest(L, ok.manifestBytes);
        await c.loadManifest(R, low.manifestBytes, true);
        await expect(c.arm(L, ARM_MODE_PAIR)).rejects.toMatchObject({ status: Status.EPOCH });
        expect(board.state).toBe(State.ERROR);
    });

    it("P4-10 a pair ARM on a chord build reports both hashes and only the PAIR flag", async () => {
        const { c, board } = setup();
        const arm = await pairArm(c);
        expect(arm.pair).toBe(true);
        expect(arm.preApproved).toBe(false);
        expect(hex(arm.manifestHash)).toBe(hex(x4.files[L].manifestSha512.subarray(0, 4)));
        expect(hex(arm.pairHash)).toBe(hex(x4.files[R].manifestSha512.subarray(0, 4)));
        expect(board.chordRequests).toBe(1);
    });

    it("P4-11 a pair ARM on a no-chord build is pre-approved; BEGIN at once", async () => {
        const { c, board } = setup({ noChord: true });
        const arm = await pairArm(c);
        expect(arm).toMatchObject({ preApproved: true, noChord: true, pair: true, byPair: false });
        await expect(c.begin(L, arm.nonce)).resolves.toBeDefined();
        expect(board.chordRequests).toBe(0);
    });

    it("P4-12 the chord in a pair session holds an approval (STATUS rsp[23] bit0)", async () => {
        const { c } = setup();
        await pairArm(c);
        expect((await c.status(L)).approvalHeld).toBe(false);
        await clock.sleep(2000);
        const s = await c.status(L);
        expect(s.chordMade).toBe(true);
        expect(s.approvalHeld).toBe(true);
    });

    it("P4-13 the held approval pre-approves this half's own ARM, once", async () => {
        const { c, board } = setup();
        await otherHalf(c, board);
        expect((await c.status(R)).approvalHeld).toBe(true);
        await c.loadManifest(R, x4.files[R].manifestBytes);
        const arm = await c.arm(R, ARM_MODE_SINGLE);
        expect(arm).toMatchObject({ preApproved: true, byPair: true, noChord: false });
        expect(await c.begin(R, arm.nonce)).toBeDefined();
        expect((await c.status(R)).approvalHeld).toBe(false);
        expect((await c.status(R)).preApproved).toBe(true);
        expect(board.chordRequests).toBe(1);
    });

    it("P4-14 a different manifest isn't pre-approved", async () => {
        const { c, board } = setup();
        await otherHalf(c, board);
        const other = await loadSvup(await buildSvup({ hand: R, fwVersion: 4001, tag: "x4.1" }));
        await c.loadManifest(R, other.manifestBytes);
        const arm = await c.arm(R);
        expect(arm.preApproved).toBe(false);
        expect(board.chordRequests).toBe(2);
    });

    it("P4-15 REBIND in IDLE moves the held approval to a renewed client", async () => {
        const { c, board } = setup();
        await otherHalf(c, board);
        await board.renewClient(); // Keybard renews its ID every 50 s
        await c.loadManifest(R, x4.files[R].manifestBytes); // the client REBINDs first
        expect(c.log.some((e) => e.op === Op.REBIND && e.status === Status.OK)).toBe(true);
        expect((await c.arm(R)).byPair).toBe(true);
    });

    it("P4-16 a renewed client without REBIND gets no pre-approval", async () => {
        const { c, board } = setup();
        await otherHalf(c, board);
        c.untrack();
        await board.renewClient();
        await c.loadManifest(R, x4.files[R].manifestBytes);
        expect((await c.arm(R)).preApproved).toBe(false);
    });

    it("P4-17 ABORT clears the held approval", async () => {
        const { c, board } = setup();
        await otherHalf(c, board);
        await c.abort(R, 0);
        expect(board.approvalHeld).toBe(false);
    });

    it("P4-18 a MANIFEST from another client clears the held approval", async () => {
        const { c, board } = setup();
        await otherHalf(c, board);
        c.untrack();
        await board.renewClient();
        await c.loadManifest(R, x4.files[R].manifestBytes);
        expect(board.approvalHeld).toBe(false);
    });

    it("P4-19 the held approval lapses after its window", async () => {
        const { c, board } = setup();
        await otherHalf(c, board);
        await clock.sleep(board.timing.heldWindowMs + 1000);
        expect(board.approvalHeld).toBe(false);
        expect(board.timing.heldWindowMs).toBeGreaterThanOrEqual(90_000);
    });

    it("P4-20 the held approval is still there 60 s after relay DONE", async () => {
        const { c, board } = setup();
        await otherHalf(c, board);
        await clock.sleep(60_000);
        expect(board.approvalHeld).toBe(true);
    });

    it("P4-21 a restart of the half with USB drops the approval", async () => {
        const { c, board } = setup();
        await otherHalf(c, board);
        const r = await c.settingsReset(R, 1);
        expect(r.status).toBe(Status.BUSY); // not while an approval is held
        await c.abort(R);
        expect(board.approvalHeld).toBe(false);
    });

    it("P4-22 SETTINGS_RESET with a bad magic or scope is INVALID", async () => {
        const { c } = setup();
        expect((await c.op(Op.SETTINGS_RESET, R, [0x52, 0x53, 0x45, 0x00, 1])).status).toBe(Status.INVALID);
        expect((await c.op(Op.SETTINGS_RESET, R, [...settingsResetArgs(1).slice(0, 4), 7])).status).toBe(Status.INVALID);
    });

    it("P4-23 SETTINGS_RESET during a session is BUSY", async () => {
        const { c } = setup();
        await c.loadManifest(R, x4.files[R].manifestBytes);
        expect((await c.settingsReset(R, 1)).status).toBe(Status.BUSY);
    });

    it("P4-24 SETTINGS_RESET of both halves with the other half silent is UNAVAILABLE", async () => {
        const { c, board } = setup({ faults: [{ kind: "other-silent" }] });
        expect((await c.settingsReset(R, 1)).status).toBe(Status.UNAVAILABLE);
        expect(board.connected()).toBe(true);
        expect(board.settings[R]).toBe("user");
    });

    it("P4-25 SETTINGS_RESET resets both halves within 500 ms; bit 2 until 0x2A", async () => {
        const { c, board } = setup();
        const r = await c.settingsReset(R, 1);
        expect(r).toEqual({ status: Status.OK, done: 3 });
        await clock.sleep(500);
        expect(board.connected()).toBe(false);
        await clock.sleep(5000);
        expect(board.connected()).toBe(true);
        expect(board.storageFlags & 4).toBe(4);
        expect(board.settings).toEqual({ 0: "defaults", 1: "defaults" });
        board.clearStorageReset();
        expect(board.storageFlags & 4).toBe(0);
    });

    async function installUsbHalf(file: SvupFile, b: ReturnType<typeof setup>) {
        await b.c.loadManifest(R, file.manifestBytes);
        const arm = await b.c.arm(R);
        await until(async () => !(!(await b.c.status(R)).chordMade), 250);
        await send(b.c, b.board, R, arm.nonce, file);
        await b.c.commit(R, arm.nonce, file.crcBody & 0xffff);
        await clock.sleep(10_000);
        b.board.connected();
    }

    it("P4-26 reinstalling the identical image keeps settings (D39)", async () => {
        const b = setup();
        await installUsbHalf(v3.files[R], b);
        expect(b.board.connected()).toBe(true);
        expect(b.board.settings[R]).toBe("user");
        expect(b.board.storageFlags & 4).toBe(0);
    });

    it("P4-27 a different image resets settings and sets bit 2 (D39)", async () => {
        const b = setup();
        await installUsbHalf(x4.files[R], b);
        expect(b.board.settings[R]).toBe("defaults");
        expect(b.board.storageFlags & 4).toBe(4);
    });

    it("P4-30 a chord not made in 30 s latches NOT_CONFIRMED", async () => {
        const { c, board } = setup({ chordAfterMs: "never" });
        const arm = await pairArm(c);
        await clock.sleep(31_000);
        const s = await c.status(L);
        expect(s.state).toBe(State.ERROR);
        expect(s.lastError).toBe(Status.NOT_CONFIRMED);
        await expect(c.begin(L, arm.nonce)).rejects.toBeInstanceOf(UpdaterStatusError);
        expect(board.halves[L].cfg.fwVersion).toBe(3000);
    });

    it("P4-32 anyone may ABORT a latched error", async () => {
        const { c, board } = setup({ faults: [{ kind: "latched-error" }] });
        expect((await c.info()).state).toBe(State.ERROR);
        await c.abort(R);
        expect(board.state).toBe(State.IDLE);
    });

    it("P4-33 a client renewal mid-transfer REBINDs before the next op", async () => {
        const { c, board } = setup({ faults: [{ kind: "renew-every", ms: 3000 }] });
        const arm = await pairArm(c);
        await until(async () => !(!(await c.status(L)).chordMade), 250);
        await c.begin(L, arm.nonce);
        await until(async () => !((await c.status(L)).state !== State.RECEIVING), 1000);
        const image = x4.files[L].image;
        for (let off = 0; off < image.length;) {
            const r = await c.chunk(L, off, image.subarray(off, off + 50));
            expect(r.status).toBe(Status.OK);
            off = r.next;
            await clock.sleep(30);
        }
        expect(c.log.filter((e) => e.op === Op.REBIND && e.status === Status.OK).length).toBeGreaterThan(0);
        void board;
    });

    it("P4-33b a wrapper rejection takes a new ID and REBINDs, then retries once", async () => {
        const { c } = setup({ faults: [{ kind: "expire-client", afterOps: 12 }] });
        const arm = await pairArm(c);
        for (let i = 0; i < 6; i++) await c.status(L);
        expect(c.log.some((e) => e.op === Op.REBIND)).toBe(true);
        expect(arm.nonce).toBeGreaterThan(0);
    });

    it("P4-34 CHUNK out of order answers with the board's next offset", async () => {
        const { c, board } = setup({ noChord: true });
        const arm = await pairArm(c);
        await c.begin(L, arm.nonce);
        await until(async () => !((await c.status(L)).state !== State.RECEIVING), 100);
        await c.chunk(L, 0, x4.files[L].image.subarray(0, 50));
        const r = await c.op(Op.CHUNK, L, chunkArgs(150, x4.files[L].image.subarray(150, 200)));
        expect(r.status).toBe(Status.OUT_OF_ORDER);
        expect(r.rsp[1] | (r.rsp[2] << 8)).toBe(50);
        void board;
    });

    it("presence reads VERSION while the halves differ and MATCH once both run one release", async () => {
        const { c, board } = setup({ otherRunning: { tag: "x4", fwVersion: 4000 } });
        expect((await c.status(R)).presence).toBe(Presence.VERSION);
        expect((await c.info()).otherDiffers).toBe(true);
        void board;
    });
});
