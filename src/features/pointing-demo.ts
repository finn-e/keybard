// Review params for the pointing devices, read once per page load and never saved.
// Nothing happens without them.
//
//   ?demo=pointing            load the QWERTY Example with a left touchpad and a right
//                             trackball (the demo layout has no pointing instances)
//   &left= &right=            trackball | touchpad | none, per hand (also works on a board)
//   &sniper=1 &boost=1        hold sniper or boost on (simulated; a board reports its own)
//   &hand=left|right          the hand that moves (default: the right)
//   &motion=0                 no scripted motion (default: on in the demo)
//   &ball=<id> / &leftBall=   show that ball for this load (see pointing-look.service)
//   &panel=settings           open Settings on start; typing, clusters, fragments,
//                             hardware or about open it at that card
//
// The scripted motion is the round 5 prototype's finger paths, turned into the
// same raw counts POINTING_MOTION reports, so the demo and a board drive the
// devices through one path.

import type { PointingMotionReport } from "@/utils/pointing-motion";
import { DEFAULT_TRACKBALL_CPI } from "@/components/pointing-viz/ball-gearing";
import { settingsSectionForPanel } from "@/layout/SecondarySidebar/Panels/settings/anchor";

export type DemoKind = "trackball" | "touchpad" | "none";
export interface PointingDemo {
    /** ?demo=pointing: the demo devices are drawn even on a layout without pointing instances. */
    demo: boolean;
    left?: DemoKind;
    right?: DemoKind;
    sniper: boolean;
    boost: boolean;
    hand: "left" | "right";
    motion: boolean;
    /** "settings", or the old panel name of a section of Settings (settings/anchor.ts). */
    panel?: string;
}

function kindParam(v: string | null): DemoKind | undefined {
    const s = v?.trim().toLowerCase();
    if (s === "trackball" || s === "ball") return "trackball";
    if (s === "touchpad" || s === "pad") return "touchpad";
    if (s === "none" || s === "0") return "none";
    return undefined;
}
const on = (v: string | null) => v !== null && !/^(0|false|off|no)$/i.test(v.trim());

/** The pointing review params, or null when none are present. */
export function pointingDemoFromSearch(search: string): PointingDemo | null {
    let p: URLSearchParams;
    try { p = new URLSearchParams(search); } catch { return null; }
    const demo = p.get("demo")?.trim().toLowerCase() === "pointing" || p.get("hostDemo")?.trim().toLowerCase() === "pointing";
    const left = kindParam(p.get("left")), right = kindParam(p.get("right"));
    const sniper = on(p.get("sniper")), boost = on(p.get("boost"));
    const panelRaw = p.get("panel")?.trim().toLowerCase();
    const panel = panelRaw === "settings" || (!!panelRaw && !!settingsSectionForPanel(panelRaw)) ? panelRaw : undefined;
    if (!demo && !left && !right && !sniper && !boost && !p.has("motion") && !panel) return null;
    return {
        demo,
        left: left ?? (demo ? "touchpad" : undefined),
        right: right ?? (demo ? "trackball" : undefined),
        sniper,
        boost,
        hand: p.get("hand")?.trim().toLowerCase() === "left" ? "left" : "right",
        motion: p.has("motion") ? on(p.get("motion")) : demo,
        panel,
    };
}

let cached: PointingDemo | null | undefined;
/** This page's params (read once). */
export function pointingDemo(): PointingDemo | null {
    if (cached === undefined) cached = typeof window === "undefined" ? null : pointingDemoFromSearch(window.location.search);
    return cached;
}
export function _resetPointingDemoForTests() { cached = undefined; }

/* ------------------------------------------------------------------ */
/* Scripted motion                                                      */
/* ------------------------------------------------------------------ */

/** Counts per mm the demo reports, as a sensor at the default CPI would (it reports no CPI). */
export const DEMO_COUNTS_PER_MM = DEFAULT_TRACKBALL_CPI / 25.4;
const BALL_RADIUS_MM = 22;

function smooth(a: number, b: number, x: number) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

/** Ball surface velocity in ball radii per second; rests at the start of every 8 s cycle. */
export function fingerPath(t: number, phase: number): [number, number] {
    const T = 8, u = ((t + phase) % T + T) % T;
    const env = smooth(0.7, 1.4, u) * (1 - smooth(5.6, 6.6, u));
    const tt = t + phase * 1.7;
    const vx = 1.25 * (Math.sin(0.9 * tt) + 0.55 * Math.sin(2.1 * tt + 1.0));
    const vy = 1.25 * (Math.cos(0.7 * tt + 0.3) + 0.45 * Math.sin(1.7 * tt));
    return [vx * env, vy * env];
}

/** Touchpad finger: lands, glides, lifts, rests. Position in pad half-extents (-1..1). */
export function padPath(t: number, phase: number) {
    const T = 6, u = ((t + phase) % T + T) % T;
    const tt = t + phase;
    const x = 0.55 * Math.sin(0.8 * tt) + 0.15 * Math.sin(2.3 * tt);
    const y = 0.45 * Math.cos(0.6 * tt + 0.5) + 0.12 * Math.sin(1.9 * tt);
    const press = smooth(0.4, 0.55, u) * (1 - smooth(4.25, 4.55, u));
    return { x, y, down: u > 0.4 && u < 4.4, press };
}

/** Pad counts across its half-width: the demo pad's resolution. */
export const PAD_COUNTS_PER_HALF = 300;

function emptyHalf() {
    return { valid: false, scrolling: false, saturated: false, autoMouse: false, touchValid: false, fingers: 0, dx: 0, dy: 0, h: 0, v: 0, buttons: 0, touchX: 0, touchY: 0 };
}

/**
 * A scripted POINTING_MOTION report for the interval (t0, t1] seconds: the
 * moving hand's device moves, the other rests. Touch position is reported for
 * the pad (as future firmware will), so its fingertip lands where the path says.
 */
export function demoReport(d: PointingDemo, t0: number, t1: number): PointingMotionReport {
    const left = emptyHalf(), right = emptyHalf();
    for (const side of ["left", "right"] as const) {
        const kind = d[side];
        const half = side === "left" ? left : right;
        if (!kind || kind === "none") continue;
        half.valid = true;
        if (!d.motion || side !== d.hand) continue;
        if (kind === "trackball") {
            const [vx, vy] = fingerPath(t1, side === "right" ? 3.3 : 0);
            const scale = (t1 - t0) * BALL_RADIUS_MM * DEMO_COUNTS_PER_MM;
            half.dx = Math.round(vx * scale);
            half.dy = Math.round(vy * scale);
        } else {
            const a = padPath(t0, 0), b = padPath(t1, 0);
            if (b.down) {
                half.touchValid = true;
                half.fingers = 1;
                half.touchX = Math.round((b.x * 0.5 + 0.5) * 255);
                half.touchY = Math.round((b.y * 0.5 + 0.5) * 255);
                if (a.down) {
                    half.dx = Math.round((b.x - a.x) * PAD_COUNTS_PER_HALF);
                    half.dy = Math.round((b.y - a.y) * PAD_COUNTS_PER_HALF);
                }
            }
        }
    }
    return {
        sniper: d.sniper, boost: d.boost, autoMouseLayer: false, axisLockEnabled: false, naturalScroll: false, scrollKey: false,
        elapsedMs: Math.round((t1 - t0) * 1000), axisLock: "free", left, right,
    };
}
