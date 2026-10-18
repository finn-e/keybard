import { useEffect, useRef, type CSSProperties } from "react";

import { MM_PER_U, type DevicePlacement } from "@/utils/pointing-geometry";
import type { PointingMotionReport } from "@/utils/pointing-motion";
import type { VelocityScrollState } from "@/utils/velocity-scroll";
import { PAD_COUNTS_PER_HALF } from "@/features/pointing-demo";
import { ballRollRadians } from "./ball-gearing";
import { BALLS, type BallId } from "./webgl/materials";
import { drawDevice, roll, rotFromEuler, type Theme } from "./webgl/renderer";
import { drawContact, drawPadReticle, drawPills, drawReticle, pillFont, type PillColors } from "./overlay-draw";
import { drawVelocity, FALLBACK_VELOCITY_COLORS, velocityHere, velocityViz, type VelocityColors, type VelocityViz } from "./velocity-draw";
import { padFromRelative, syncFingers, type Finger } from "./pad-contacts";

/** A source of POINTING_MOTION reports: the board, Keybard Host, or the demo script. */
export interface PointingFeed {
    subscribe(listener: (report: PointingMotionReport, dtMs: number) => void): () => void;
}

/** How long a touchpad contact stays after the last motion before it lifts. */
const PAD_LIFT_MS = 160;

export interface PointingDeviceProps {
    placement: DevicePlacement;
    /** CSS px per key unit. */
    unitPx: number;
    ball: BallId;
    gloss: number;
    sparkle: number;
    /** Body lightness override (see bodyAt); omitted = the ball's own. */
    lightness?: number;
    theme: Theme;
    feed: PointingFeed | null;
    /** Sniper and boost in force (the pills show at this hand only when `showModes`). */
    sniper: boolean;
    boost: boolean;
    showModes: boolean;
    labels: { sniper: string; boost: string };
    pillColors: PillColors;
    /** Velocity Scroll's colors (from --kb-pointing-velocity and the pill tokens). */
    velocityColors?: VelocityColors;
    /** Show the Velocity Scroll pill while it is held (the Overlay's pills setting). Default on. */
    velocityPill?: boolean;
    /** The other hand's device, which decides where a trackball's Velocity Scroll shows. */
    otherKind?: "ball" | "pad" | null;
    /** The Velocity Scroll look (review switch); default from ?velViz=. */
    velocityViz?: VelocityViz;
    /** Device hidden: only the pills, centered where it would be (Keybard Host). */
    ghost?: boolean;
    host?: boolean;
    /** Offset of the layout's origin in CSS px inside the positioned parent. */
    originPx?: { x: number; y: number };
    /** Right-click or long press on a trackball. There is no keyboard shortcut. */
    onMenu?: (x: number, y: number) => void;
    /** This hand moved (so it carries the pills). */
    onMoved?: (side: "left" | "right") => void;
}

function prefersReducedMotion(): boolean {
    try { return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
}

const LONG_PRESS_MS = 550;

/**
 * One pointing device at true size: a trackball or a touchpad drawn as the
 * physical object, rolling or touched as the board reports, with the sniper
 * and boost pills (and the reticle while sniper is on). It draws only while
 * something moves; with reduced motion it stays still.
 */
export function PointingDevice(props: PointingDeviceProps) {
    const { placement: pl, unitPx, ghost = false } = props;
    const side = pl.side;
    const deviceRef = useRef<HTMLCanvasElement>(null);
    const overlayRef = useRef<HTMLCanvasElement>(null);
    const latest = useRef(props);
    latest.current = props;
    const sim = useRef({
        M: rotFromEuler(side === "right" ? 1.3 : 0.4, side === "right" ? 0.6 : -0.3, side === "right" ? -0.9 : 0.2),
        contact: { x: 0, y: 0, press: 0, last: -1e9 },
        /** Every finger the board reports on this pad (POINTING_CONTACTS), by contact ID. */
        fingers: new Map<number, Finger>(),
        sm: { sniper: 0, boost: 0, vel: 0 },
        /** The board's last Velocity Scroll state (kept while it fades out). */
        vs: null as VelocityScrollState | null,
        vsHeld: false,
        dirty: true,
        ovDirty: true,
        raf: 0,
        lastT: 0,
        reduce: prefersReducedMotion(),
    });

    const sizeCss = pl.sizeU * unitPx;
    const ballPx = (pl.dU / 2) * unitPx;
    const hw = ((pl.w ?? 0) / 2) * unitPx, hh = ((pl.h ?? 0) / 2) * unitPx;
    const reach = pl.kind === "ball" ? ballPx : Math.hypot(hw, hh) * 0.86;
    const ovCss = (pl.kind === "ball" ? pl.dU * unitPx * 2.1 : pl.dU * unitPx * 1.7) + 240;
    const origin = props.originPx ?? { x: 0, y: 0 };
    const cxPx = origin.x + pl.cx * unitPx, cyPx = origin.y + pl.cy * unitPx;

    // One frame loop per device, started on demand and stopped when nothing moves.
    const wake = useRef<() => void>(() => {});
    useEffect(() => {
        const s = sim.current;
        const frame = (now: number) => {
            s.raf = 0;
            const p = latest.current;
            const dt = s.lastT ? Math.min(0.05, (now - s.lastT) / 1000) : 0;
            s.lastT = now;
            let busy = false;
            // modes ease in and out at the moving hand
            const ts = p.showModes && p.sniper ? 1 : 0, tb = p.showModes && p.boost ? 1 : 0;
            const step = (target: number, cur: number) => s.reduce ? target
                : cur + Math.sign(target - cur) * Math.min(Math.abs(target - cur), dt / (target > cur ? 0.18 : 0.15));
            const tv = s.vsHeld && velocityHere(p, s.vs) ? 1 : 0;
            const ns = step(ts, s.sm.sniper), nb = step(tb, s.sm.boost), nv = step(tv, s.sm.vel);
            if (ns !== s.sm.sniper || nb !== s.sm.boost || nv !== s.sm.vel) { s.ovDirty = true; }
            s.sm.sniper = ns; s.sm.boost = nb; s.sm.vel = nv;
            if (ns !== ts || nb !== tb || nv !== tv) busy = true;
            if (p.placement.kind === "pad") {
                const ease = (c: { press: number }, target: number) => {
                    const before = c.press;
                    c.press = s.reduce ? 0 : before + (target - before) * Math.min(1, dt / 0.06);
                    if (Math.abs(c.press - target) < 0.005) c.press = target;
                    if (c.press !== before) s.ovDirty = true;
                    if (c.press !== target || target === 1) busy = true;
                };
                ease(s.contact, now - s.contact.last < PAD_LIFT_MS ? 1 : 0);
                for (const [id, f] of s.fingers) {
                    ease(f, f.down ? 1 : 0);
                    if (!f.down && f.press === 0) { s.fingers.delete(id); s.ovDirty = true; }
                }
            }
            if (s.dirty && !p.ghost && deviceRef.current) {
                const dpr = Math.min(typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1, 2);
                drawDevice(deviceRef.current, p.placement.sizeU * p.unitPx * dpr, {
                    kind: p.placement.kind, mat: p.ball, M: s.M, view: p.placement.view,
                    w: p.placement.w, h: p.placement.h, corner: p.placement.corner, gloss: p.gloss, sparkle: p.sparkle, lightness: p.lightness,
                }, p.theme);
                s.dirty = false;
            }
            if (s.ovDirty) { drawOverlay(); s.ovDirty = false; }
            if (busy) s.raf = requestAnimationFrame(frame);
            else s.lastT = 0;
        };
        const drawOverlay = () => {
            const cv = overlayRef.current;
            const p = latest.current;
            if (!cv) return;
            const ctx = cv.getContext("2d");
            if (!ctx) return;
            const dpr = Math.min(typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1, 2);
            const pxSize = Math.max(2, Math.round(ovCss * dpr));
            if (cv.width !== pxSize) { cv.width = pxSize; cv.height = pxSize; }
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, pxSize, pxSize);
            const k = pxSize / ovCss;
            ctx.setTransform(k, 0, 0, k, pxSize / 2, pxSize / 2);
            const first = [...s.fingers.values()].find((f) => f.down);
            const c = first ?? s.contact;
            if (p.placement.kind === "pad" && !p.ghost) {
                drawContact(ctx, hw, hh, s.contact.x, s.contact.y, s.contact.press, p.unitPx, k);
                for (const f of s.fingers.values()) drawContact(ctx, hw, hh, f.x, f.y, f.press, p.unitPx, k);
            }
            if (!p.ghost) {
                if (p.placement.kind === "ball") drawReticle(ctx, ballPx, s.sm.sniper, k);
                else drawPadReticle(ctx, hw, hh, (p.placement.corner ?? 0.2) * p.unitPx, c.x * hw, c.y * hh, s.sm.sniper, p.unitPx, k);
                if (s.vs && s.sm.vel > 0.001) drawHeld(ctx, s.vs, k);
            }
            drawPills(ctx, [
                { kind: "sniper", amount: s.sm.sniper, mult: p.labels.sniper },
                { kind: "boost", amount: s.sm.boost, mult: p.labels.boost },
                { kind: "velocity", amount: p.velocityPill === false ? 0 : s.sm.vel, mult: "" },
            ], { side: p.placement.side, r: reach, unitPx: p.unitPx, centered: !!p.ghost, host: !!p.host, colors: p.pillColors });
        };
        // Velocity Scroll: the anchor, the dead zone, the offset and the speed.
        const drawHeld = (ctx: CanvasRenderingContext2D, vs: VelocityScrollState, k: number) => {
            const p = latest.current;
            const pxPerMm = p.unitPx / MM_PER_U;
            const onPad = p.placement.kind === "pad" && vs.padHand === side;
            let anchor = { x: 0, y: 0 };
            if (onPad) {
                // The anchor is where the finger touched down: the finger now, less the offset.
                const f = [...s.fingers.values()].find((g) => g.down) ?? (s.contact.press > 0.02 ? s.contact : null);
                if (!f) return;
                anchor = { x: f.x * hw - vs.offsetMm.x * pxPerMm, y: f.y * hh - vs.offsetMm.y * pxPerMm };
            }
            drawVelocity(ctx, vs, {
                viz: p.velocityViz ?? velocityViz(), kind: onPad ? "pad" : "ball", side, amount: s.sm.vel, anchor,
                // a pad driven as a relative pointer draws the trackball's field over the glass
                reach: p.placement.kind === "ball" ? ballPx : Math.min(hw, hh) * 0.9,
                pxPerMm, unitPx: p.unitPx, k, colors: p.velocityColors ?? FALLBACK_VELOCITY_COLORS, fontPx: pillFont(p.unitPx, !!p.host),
                bottom: p.placement.kind === "ball" ? ballPx : hh,
                glass: p.placement.kind === "pad" ? { hw, hh, corner: (p.placement.corner ?? 0.2) * p.unitPx } : undefined,
            });
        };
        wake.current = () => { if (!s.raf && typeof requestAnimationFrame === "function") s.raf = requestAnimationFrame(frame); };
        wake.current();
        return () => { if (s.raf) cancelAnimationFrame(s.raf); s.raf = 0; };
    }, [ovCss, ballPx, hw, hh, reach]);

    // Anything that changes the look redraws once.
    useEffect(() => {
        sim.current.dirty = true; sim.current.ovDirty = true; wake.current();
    }, [props.ball, props.gloss, props.sparkle, props.lightness, props.theme, sizeCss, props.sniper, props.boost, props.showModes, props.labels.sniper, props.labels.boost, ghost, props.pillColors.bg, props.pillColors.fg, props.velocityColors?.accent, props.velocityPill, props.otherKind, props.velocityViz]);

    // Motion from the feed rolls the ball or moves the fingertip.
    useEffect(() => {
        const feed = props.feed;
        if (!feed) return;
        const s = sim.current;
        const off = feed.subscribe((report) => {
            // Velocity Scroll first: it shows even while this hand reports nothing.
            const vs = report.velocityScroll;
            if (vs?.held || s.vsHeld) {
                s.vsHeld = !!vs?.held;
                if (vs?.held) s.vs = vs;
                s.ovDirty = true;
                wake.current();
            }
            const half = report[side];
            if (!half?.valid) return;
            const p = latest.current;
            if (p.placement.kind === "pad" && half.contacts) {
                // The board says where every finger is: draw those, never the motion.
                const changed = syncFingers(s.fingers, half.contacts);
                if (half.contacts.length > 0) s.contact.last = -1e9;
                if (!changed) return;
                s.ovDirty = true;
                if (half.contacts.length > 0) p.onMoved?.(side);
                wake.current();
                return;
            }
            const moved = half.dx !== 0 || half.dy !== 0 || half.touchValid;
            if (!moved) return;
            if (!s.reduce) {
                if (p.placement.kind === "ball") {
                    // The ball's physical size, not its drawn size, at the CPI the board
                    // reports for this hand (the firmware default on older boards).
                    const mm = BALLS[p.ball].mm;
                    roll(s.M, ballRollRadians(half.dx, mm, half.cpi), ballRollRadians(half.dy, mm, half.cpi));
                    s.dirty = true;
                } else {
                    const c = s.contact;
                    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
                    const at = padFromRelative(c, half, now - c.last >= PAD_LIFT_MS, PAD_COUNTS_PER_HALF);
                    c.x = at.x; c.y = at.y;
                    c.last = now;
                    s.ovDirty = true;
                }
            }
            p.onMoved?.(side);
            wake.current();
        });
        return () => { off(); s.vsHeld = false; s.ovDirty = true; wake.current(); };
    }, [props.feed, side]);

    // Right-click or a long press opens the ball menu (trackballs only).
    const press = useRef<{ x: number; y: number; t: ReturnType<typeof setTimeout> } | null>(null);
    const menuable = pl.kind === "ball" && !ghost && !!props.onMenu;
    const ballName = BALLS[props.ball].name;
    const label = `${side === "left" ? "Left" : "Right"} ${pl.kind === "ball" ? `trackball, ${ballName}` : "touchpad"}`;

    const box = (size: number): CSSProperties => ({ position: "absolute", left: cxPx - size / 2, top: cyPx - size / 2, width: size, height: size });
    return (
        <>
            {!ghost && (
                <canvas
                    ref={deviceRef}
                    role="img"
                    aria-label={label}
                    data-pointing-device={side}
                    data-pointing-kind={pl.kind}
                    data-ball={pl.kind === "ball" ? props.ball : undefined}
                    className={menuable ? "pointer-events-auto" : "pointer-events-none"}
                    style={{
                        ...box(sizeCss),
                        clipPath: pl.kind === "ball" ? `circle(${ballPx}px at 50% 50%)` : undefined,
                        touchAction: "manipulation",
                    }}
                    onContextMenu={menuable ? (e) => { e.preventDefault(); props.onMenu!(e.clientX, e.clientY); } : undefined}
                    onPointerDown={menuable ? (e) => {
                        if (e.pointerType !== "touch") return;
                        const x = e.clientX, y = e.clientY;
                        press.current = { x, y, t: setTimeout(() => { press.current = null; props.onMenu!(x, y); }, LONG_PRESS_MS) };
                    } : undefined}
                    onPointerMove={menuable ? (e) => {
                        if (press.current && Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) > 8) { clearTimeout(press.current.t); press.current = null; }
                    } : undefined}
                    onPointerUp={menuable ? () => { if (press.current) { clearTimeout(press.current.t); press.current = null; } } : undefined}
                    onPointerCancel={menuable ? () => { if (press.current) { clearTimeout(press.current.t); press.current = null; } } : undefined}
                />
            )}
            <canvas ref={overlayRef} aria-hidden="true" data-pointing-overlay={side} className="pointer-events-none" style={box(ovCss)} />
        </>
    );
}
