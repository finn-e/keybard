// The checks the update sheet (B1) runs before Start: what the board runs, which
// file goes to which half, the warnings (update-flow 4.2) and the one refusal.
// Gentle: hardware mismatches warn and the button reads "Update anyway"; only a
// carried file that misses its pin, or a file a half would refuse, stops the install.

import { matchPin, type FirmwareReleasePin } from "@/constants/firmware-releases";
import { UpdaterClient, UpdaterStatusError } from "./client";
import {
    HAND_SELF, POINTING_AUTO, POINTING_NAMES, Presence, State, Status, UPDATER_PROTOCOL, handName, otherHand,
    statusName, type Hand, type Info0, type Info1, type StatusReply,
} from "./protocol";
import type { SvupFile } from "./svup";
import type { Clock } from "./transport";

export type CheckState = "pending" | "ok" | "warn" | "refuse";

export interface CheckRow {
    id: string;
    label: string;
    state: CheckState;
    detail?: string;
}

/** The install as the user picked it on the Firmware page. */
export type InstallSource =
    | { kind: "release"; release: FirmwareReleasePin; files: Partial<Record<Hand, SvupFile>> }
    | { kind: "file"; files: SvupFile[] };

export type InstallKind = "update" | "reinstall" | "install" | "custom";

export type Target = "both" | Hand;

export interface BoardState {
    usb: Info0;
    usbTag: string;
    other: Info0 | null;
    status: StatusReply;
    /** INFO page 0 flags bit7 on the half with USB (F-N1). */
    noChord: boolean;
}

/** A stop before the sheet can offer Start (update-flow 8). */
export type PreFailure = { id: "F3" | "F17" | "F18" | "unsupported"; detail?: string };

export interface Plan {
    board: BoardState;
    target: Target;
    files: Partial<Record<Hand, SvupFile>>;
    kind: InstallKind;
    /** The release being installed: a tag, or the file's own version string. */
    toTag: string;
    fromTag: string;
    title: string;
    checks: CheckRow[];
    warnings: CheckRow[];
    refusal: CheckRow | null;
    /** The other half didn't answer: offer the half with USB only. */
    otherSilent: boolean;
    pinned: boolean;
}

export interface CheckOptions {
    clock: Clock;
    /** The user chose one half (Advanced, or Finish update). */
    onlyHand?: Hand;
    /** Sval protocol this Keybard speaks (K18). */
    maxSvalProtocol?: number;
    releases?: FirmwareReleasePin[];
    /** Extra rows from the host: Keybard Overlay paused, Scan Lab closed, device access. */
    hostRows?: CheckRow[];
}

const HAND_LABEL = (h: number) => `${handName(h) === "left" ? "Left" : "Right"} half`;

/** Read what the board runs: INFO of both halves, the tag, presence. ABORTs a latched error first. */
export async function readBoard(client: UpdaterClient, clock: Clock): Promise<BoardState | PreFailure> {
    let usb = await client.info(HAND_SELF);
    if (usb.protocol !== UPDATER_PROTOCOL) return { id: "unsupported", detail: `updater protocol ${usb.protocol}` };
    if (!usb.flash16MiB) return { id: "F18" };
    if (usb.writesFailing) return { id: "F17" };
    if (usb.state === State.ERROR) {
        // A tab that died mid-session left an error latched: anyone may clear it.
        await client.abort(usb.hand);
        usb = await client.info(HAND_SELF);
    }
    if (usb.state !== State.IDLE) return { id: "F3", detail: `the updater is busy (${usb.state})` };
    const page1: Info1 = await client.info1();
    const hand = usb.hand as Hand;
    let status = await client.status(hand);
    const deadline = clock.now() + 5000;
    while (status.presence === Presence.NONE && clock.now() < deadline) {
        await clock.sleep(250);
        status = await client.status(hand);
    }
    let other: Info0 | null = null;
    if (status.presence === Presence.MATCH || status.presence === Presence.VERSION) {
        const o = await client.info(otherHand(hand));
        other = o.answered ? o : null;
    }
    return { usb, usbTag: page1.tag, other, status, noChord: usb.noChord };
}

/** Why a half would refuse this file, as far as its INFO shows (null: none seen). */
export function refusalFor(file: SvupFile, half: Info0, isOther: boolean): string | null {
    const m = file.manifest;
    const ok = isOther ? [2, 3, 4] : [UPDATER_PROTOCOL];
    if (!ok.includes(half.protocol)) return `it speaks updater protocol ${half.protocol}`;
    // A no-chord build (D43) is a developer file even if it was packed without DIAGNOSTIC.
    if (half.releaseBuild && (m.diagnostic || file.noChord)) return "it's a developer file and this keyboard runs a release";
    if (m.securityEpoch < half.securityEpoch) return "it's older than this keyboard allows";
    if (m.storageFormat < half.storageFormat) return "its settings format is older than this keyboard's";
    if (m.imageLen > half.maxImage) return "it's too large for this keyboard";
    if (!file.imageHashOk) return "the file is damaged";
    return null;
}

function assignFiles(source: InstallSource): { files: Partial<Record<Hand, SvupFile>>; problems: CheckRow[] } {
    if (source.kind === "release") return { files: source.files, problems: [] };
    const files: Partial<Record<Hand, SvupFile>> = {};
    const problems: CheckRow[] = [];
    for (const f of source.files) {
        const h = f.manifest.hand === 0 || f.manifest.hand === 1 ? (f.manifest.hand as Hand) : null;
        if (h === null) problems.push({ id: "file-hand", label: "File names no hand", state: "refuse", detail: "Keybard can't tell which half it's for." });
        else if (files[h]) problems.push({ id: "file-twice", label: `Two files for the ${handName(h)} hand`, state: "refuse", detail: "Choose one file per half." });
        else files[h] = f;
    }
    return { files, problems };
}

function kindFor(board: BoardState, file: SvupFile, pinned: boolean): InstallKind {
    if (!pinned) return "custom";
    if (file.manifest.fwVersion === board.usb.fwVersion && file.manifest.tag === board.usbTag) return "reinstall";
    return file.manifest.fwVersion > board.usb.fwVersion ? "update" : "install";
}

export function titleFor(kind: InstallKind, tag: string): string {
    switch (kind) {
        case "update": return `Update to ${tag}`;
        case "reinstall": return `Reinstall ${tag}`;
        case "install": return `Install ${tag}`;
        default: return "Install custom firmware";
    }
}

/** Every check of tech doc 2.1 and update-flow 4.1-4.2, against the board as it is now. */
export async function planInstall(client: UpdaterClient, source: InstallSource, o: CheckOptions): Promise<Plan | PreFailure> {
    const read = await readBoard(client, o.clock).catch((error) => {
        if (error instanceof UpdaterStatusError && (error.status === Status.OTHER_CLIENT || error.status === Status.BUSY)) return { id: "F3" } as PreFailure;
        throw error;
    });
    if ("id" in read) return read;
    const board = read;
    const usbHand = board.usb.hand as Hand;
    const oHand = otherHand(usbHand);
    const { files, problems } = assignFiles(source);
    const checks: CheckRow[] = [];
    const warnings: CheckRow[] = [];
    let refusal: CheckRow | null = problems[0] ?? null;

    const otherSilent = !board.other;
    let target: Target;
    if (o.onlyHand !== undefined) target = o.onlyHand;
    else if (files[usbHand] && files[oHand]) target = otherSilent ? usbHand : "both";
    else target = files[usbHand] ? usbHand : oHand;
    if (target === oHand && otherSilent) refusal ??= { id: "other-silent", label: `${HAND_LABEL(oHand)} not answering`, state: "refuse", detail: "Check the split cable." };

    const halves: Hand[] = target === "both" ? [oHand, usbHand] : [target];
    for (const h of halves) if (!files[h]) refusal ??= { id: `missing-${h}`, label: `No file for the ${handName(h)} half`, state: "refuse", detail: "Choose a file for that half." };

    // Connection
    checks.push(otherSilent
        ? { id: "connected", label: `${HAND_LABEL(oHand)} not answering`, state: "warn", detail: "Check the split cable." }
        : { id: "connected", label: "Both halves connected", state: "ok" });
    if (otherSilent && target === usbHand && o.onlyHand === undefined && files[oHand]) warnings.push(checks[checks.length - 1]);

    // Integrity: a carried file must match its pin; that's the only refusal of a file Keybard chose.
    const releases = o.releases;
    let pinned = true;
    let integrityOk = true;
    for (const h of halves) {
        const f = files[h];
        if (!f) continue;
        const pin = matchPin(f.sha256, releases);
        if (source.kind === "release") {
            const want = h === 0 ? source.release.files.left.sha256 : source.release.files.right.sha256;
            if (f.sha256 !== want) integrityOk = false;
        } else if (!pin) {
            pinned = false;
        }
        if (!f.imageHashOk) integrityOk = false;
    }
    if (!integrityOk) {
        refusal = { id: "integrity", label: "Firmware file failed its check", state: "refuse", detail: "Keybard won't install it. Reload Keybard and try again." };
        checks.push(refusal);
    } else {
        checks.push({ id: "files", label: "Firmware files verified", state: "ok" });
    }
    if (source.kind === "file" && !pinned) warnings.push({ id: "unknown-file", label: "Unknown firmware file", state: "warn", detail: "Keybard can't check where it came from." });

    // What each half would refuse (checked on the device too, at the pair ARM).
    for (const h of halves) {
        const f = files[h];
        const info = h === usbHand ? board.usb : board.other;
        if (!f || !info) continue;
        const why = refusalFor(f, info, h !== usbHand);
        if (why) refusal ??= { id: `refused-${h}`, label: `The ${handName(h)} half won't accept this file`, state: "refuse", detail: `Keybard won't install it: ${why}.` };
    }
    // The USB half checks the other half's file and its own at the pair ARM; check its own against itself too.
    if (target === "both" && files[usbHand]) {
        const why = refusalFor(files[usbHand]!, board.usb, false);
        if (why) refusal ??= { id: `refused-${usbHand}`, label: `The ${handName(usbHand)} half won't accept this file`, state: "refuse", detail: `Keybard won't install it: ${why}.` };
    }

    // Warnings, never refusals (D33).
    for (const h of halves) {
        const f = files[h];
        const info = h === usbHand ? board.usb : board.other;
        if (!f || !info) continue;
        if (f.manifest.hand !== h) warnings.push({ id: `hand-${h}`, label: `File is for the ${handName(f.manifest.hand)} hand`, state: "warn", detail: `On the ${handName(h)} half, the halves stop working together.` });
        if (f.manifest.pointingId !== POINTING_AUTO && f.manifest.pointingId !== info.pointingId) {
            const module = POINTING_NAMES[info.pointingId] ?? "pointing module";
            warnings.push({ id: `pointing-${h}`, label: `No ${module.toLowerCase()} driver in this file`, state: "warn", detail: `Pointing stops on the ${handName(h)} half.` });
        }
    }
    const lead = files[target === "both" ? usbHand : target]!;
    if (lead && lead.manifest.fwVersion < board.usb.fwVersion) {
        warnings.push({ id: "older", label: `${lead.manifest.tag || "This file"} is older than ${board.usbTag || "what's installed"}`, state: "warn", detail: `Settings added since ${lead.manifest.tag || "it"} won't come back.` });
    }
    if (source.kind === "release" && o.maxSvalProtocol !== undefined && (source.release.svalProtocol ?? 0) > o.maxSvalProtocol) {
        warnings.push({ id: "sval-protocol", label: "Keybard may not configure this firmware", state: "warn", detail: "You can still install it." });
    }
    if (halves.some((h) => files[h]?.noChord)) warnings.push({ id: "developer", label: "Developer build", state: "warn", detail: "Later installs on this keyboard won't ask for approval." });
    for (const row of o.hostRows ?? []) {
        checks.push(row);
        if (row.state === "warn") warnings.push(row);
    }

    const toTag = lead?.manifest.tag || (source.kind === "release" ? source.release.tag : "custom firmware");
    const kind = lead ? kindFor(board, lead, pinned) : "custom";
    return {
        board, target, files, kind, toTag, fromTag: board.usbTag, title: titleFor(kind, toTag), checks, warnings, refusal,
        otherSilent, pinned,
    };
}

export const describeStatus = statusName;
