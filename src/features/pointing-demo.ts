// Review params for the pointing devices, read once per page load and never saved.
// Nothing happens without them.
//
//   ?demo=pointing            load the QWERTY Example with a left touchpad and a right
//                             trackball (the demo layout has no pointing instances)
//   &left= &right=            trackball | touchpad | none, per hand (also works on a board)
//   &sniper=1 &boost=1        hold sniper or boost on (simulated; a board reports its own)
//   &velocity=1               hold Velocity Scroll at the moving hand, with an offset that
//                             moves (or holds still with &motion=0)
//   &offset=x,y               the still offset in mm (+x right, +y toward the user)
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
import { TOUCHPAD_MM } from "@/components/pointing-viz/webgl/materials";
import { velocityStateFor } from "@/utils/velocity-scroll";
import { settingsSectionForPanel } from "@/layout/SecondarySidebar/Panels/settings/anchor";

export type DemoKind = "trackball" | "touchpad" | "none";
export interface PointingDemo {
    /** ?demo=pointing: the demo devices are drawn even on a layout without pointing instances. */
    demo: boolean;
    left?: DemoKind;
    right?: DemoKind;
    sniper: boolean;
    boost: boolean;
    /** Velocity Scroll held at the moving hand (simulated). */
    velocity: boolean;
    /** &offset=x,y: Velocity Scroll's still offset, mm. */
    offset?: { x: number; y: number };
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
/** &offset=x,y in mm, or undefined. */
function offsetParam(v: string | null): { x: number; y: number } | undefined {
    const m = v?.trim().match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/);
    if (!m) return undefined;
    const clamp = (n: number) => Math.max(-60, Math.min(60, n));
    return { x: clamp(Number(m[1])), y: clamp(Number(m[2])) };
}
const on = (v: string | null) => v !== null && !/^(0|false|off|no)$/i.test(v.trim());

/** The pointing review params, or null when none are present. */
export function pointingDemoFromSearch(search: string): PointingDemo | null {
    let p: URLSearchParams;
    try { p = new URLSearchParams(search); } catch { return null; }
    const demo = p.get("demo")?.trim().toLowerCase() === "pointing" || p.get("hostDemo")?.trim().toLowerCase() === "pointing";
    const left = kindParam(p.get("left")), right = kindParam(p.get("right"));
    const sniper = on(p.get("sniper")), boost = on(p.get("boost")), velocity = on(p.get("velocity"));
    const panelRaw = p.get("panel")?.trim().toLowerCase();
    const panel = panelRaw === "settings" || (!!panelRaw && !!settingsSectionForPanel(panelRaw)) ? panelRaw : undefined;
    if (!demo && !left && !right && !sniper && !boost && !velocity && !p.has("motion") && !panel) return null;
    return {
        demo,
        left: left ?? (demo ? "touchpad" : undefined),
        right: right ?? (demo ? "trackball" : undefined),
        sniper,
        boost,
        velocity,
        offset: offsetParam(p.get("offset")),
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
 * Velocity Scroll's scripted offset, mm (+x right, +y toward the user), at t
 * seconds: it starts away from the anchor (so a still frame shows an offset),
 * pulls toward the user to near full speed, eases back through the dead zone,
 * pushes away, and drifts sideways a little. Still (motion off): a fixed offset.
 */
export function velocityPath(t: number, kind: "trackball" | "touchpad", moving: boolean, still?: { x: number; y: number }): { x: number; y: number } {
    if (!moving && still) return { ...still };
    const reach = kind === "trackball" ? 34 : 20;
    if (!moving) return { x: kind === "trackball" ? 2.2 : 1.2, y: reach * 0.62 };
    const T = 9, u = (((t % T) + T) % T) / T;
    const y = reach * (0.62 * Math.cos(u * Math.PI * 2) + 0.18 * Math.sin(u * Math.PI * 4));
    const x = reach * 0.16 * Math.sin(u * Math.PI * 2 * 1.5 + 0.6);
    return { x, y };
}

/** Where the scripted pad finger touches down, in pad half-extents. */
export const VELOCITY_PAD_ANCHOR = { x: -0.15, y: -0.1 };

/** With a set offset, the anchor sits so the finger stays on the glass: centered between them. */
export function velocityPadAnchor(still?: { x: number; y: number }): { x: number; y: number } {
    if (!still) return VELOCITY_PAD_ANCHOR;
    return { x: -still.x / TOUCHPAD_MM.w, y: -still.y / TOUCHPAD_MM.h };
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
        if (side !== d.hand) continue;
        if (d.velocity) {
            // Velocity Scroll: the ball rolls by the offset's change; the finger sits at the anchor plus the offset.
            const a = velocityPath(t0, kind, d.motion, d.offset), b = velocityPath(t1, kind, d.motion, d.offset);
            const anchor = velocityPadAnchor(d.motion ? undefined : d.offset);
            if (kind === "trackball") {
                half.dx = Math.round((b.x - a.x) * DEMO_COUNTS_PER_MM);
                half.dy = Math.round((b.y - a.y) * DEMO_COUNTS_PER_MM);
            } else {
                const fx = anchor.x + b.x / (TOUCHPAD_MM.w / 2), fy = anchor.y + b.y / (TOUCHPAD_MM.h / 2);
                half.touchValid = true;
                half.fingers = 1;
                half.touchX = Math.round((Math.max(-1, Math.min(1, fx)) * 0.5 + 0.5) * 255);
                half.touchY = Math.round((Math.max(-1, Math.min(1, fy)) * 0.5 + 0.5) * 255);
            }
            continue;
        }
        if (!d.motion) continue;
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
    const vsKind = d[d.hand];
    const velocityScroll = d.velocity && (vsKind === "trackball" || vsKind === "touchpad")
        ? velocityStateFor(velocityPath(t1, vsKind, d.motion, d.offset), vsKind === "touchpad" ? d.hand : null)
        : undefined;
    return {
        sniper: d.sniper, boost: d.boost, autoMouseLayer: false, axisLockEnabled: false, naturalScroll: false, scrollKey: false,
        elapsedMs: Math.round((t1 - t0) * 1000), axisLock: "free", left, right,
        ...(velocityScroll ? { velocityScroll } : {}),
    };
}
