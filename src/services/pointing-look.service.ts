// Which ball sits in each hand's trackball, per board. It is a look, not a board
// setting: kept in this browser per board uid and hand (nothing is written to
// the board), carried in .svil files as cosmetic.pointing_balls, and sent to
// Keybard Host so its overlay draws the same ball. ?ball=<id> shows a ball for
// this page load without saving anything.

import { useSyncExternalStore } from "react";

import { DEFAULT_BALL, isBallId, type BallId } from "@/components/pointing-viz/webgl/materials";
import { appStorage } from "@/utils/app-storage";

export type Hand = "left" | "right";
export type BallChoice = Partial<Record<Hand, BallId>>;

const KEY_PREFIX = "pointing-ball:";
const listeners = new Set<() => void>();
let version = 0;
/** ?ball= for this load, per hand, until that hand's ball is picked. */
const override: BallChoice = {};
let overrideRead = false;
// When storage is unavailable, a pick still shows for this session.
const sessionBalls = new Map<string, BallChoice>();

function readOverride() {
    if (overrideRead || typeof window === "undefined") return;
    overrideRead = true;
    try {
        const p = new URLSearchParams(window.location.search);
        const both = p.get("ball");
        for (const hand of ["left", "right"] as const) {
            const v = p.get(`${hand}Ball`) ?? both;
            if (isBallId(v)) override[hand] = v;
        }
    } catch { /* no URL */ }
}

function keyFor(uid: string | undefined | null) {
    return KEY_PREFIX + (uid ? String(uid).toLowerCase() : "default");
}

function load(uid: string | undefined | null): BallChoice {
    try {
        const raw = appStorage.getItem(keyFor(uid));
        if (raw) return sanitizeBalls(JSON.parse(raw));
    } catch { /* storage unavailable or unreadable */ }
    return sessionBalls.get(keyFor(uid)) ?? {};
}

/** Only known balls for known hands survive (imported files and storage are untrusted). */
export function sanitizeBalls(value: unknown): BallChoice {
    const out: BallChoice = {};
    if (!value || typeof value !== "object") return out;
    for (const hand of ["left", "right"] as const) {
        const v = (value as Record<string, unknown>)[hand];
        if (isBallId(v)) out[hand] = v;
    }
    return out;
}

function emit() {
    version++;
    for (const l of [...listeners]) l();
}

/** The ball shown in one hand's trackball. */
export function getBall(uid: string | undefined | null, hand: Hand): BallId {
    readOverride();
    return override[hand] ?? load(uid)[hand] ?? DEFAULT_BALL;
}

export function getBalls(uid: string | undefined | null): Record<Hand, BallId> {
    return { left: getBall(uid, "left"), right: getBall(uid, "right") };
}

/** Saved balls only (no ?ball override), for .svil export. */
export function savedBalls(uid: string | undefined | null): BallChoice {
    return load(uid);
}

export function setBall(uid: string | undefined | null, hand: Hand, ball: BallId) {
    if (!isBallId(ball)) return;
    readOverride();
    delete override[hand];
    const next = { ...load(uid), [hand]: ball };
    try { appStorage.setItem(keyFor(uid), JSON.stringify(next)); } catch { /* storage unavailable: still shown this session */ }
    sessionBalls.set(keyFor(uid), next);
    emit();
}

/** From an imported .svil: replaces the saved balls for that board. */
export function importBalls(uid: string | undefined | null, value: unknown) {
    const balls = sanitizeBalls(value);
    if (!Object.keys(balls).length) return;
    try { appStorage.setItem(keyFor(uid), JSON.stringify(balls)); } catch { /* storage unavailable */ }
    sessionBalls.set(keyFor(uid), balls);
    emit();
}

export function subscribeBalls(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

/** Both hands' balls for a board, re-rendering when any pick changes. */
export function useBalls(uid: string | undefined | null): Record<Hand, BallId> {
    useSyncExternalStore(subscribeBalls, () => version, () => version);
    return getBalls(uid);
}

/** Tests only. */
export function _resetPointingLookForTests() {
    for (const k of Object.keys(override) as Hand[]) delete override[k];
    overrideRead = false;
    sessionBalls.clear();
    emit();
}
