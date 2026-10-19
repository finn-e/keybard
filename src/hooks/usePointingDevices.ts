import { useEffect, useMemo, useState } from "react";

import type { PointingFeed } from "@/components/pointing-viz/PointingDevice";
import { useKeyboard } from "@/contexts/KeyboardContext";
import { demoReport, pointingDemo, type PointingDemo } from "@/features/pointing-demo";
import { usePointingSlots } from "@/hooks/usePointingSlots";
import { keyboardService } from "@/services/keyboard.service";
import { getPointingLive } from "@/services/pointing-live.service";
import type { PointingMotionReport } from "@/utils/pointing-motion";

export type DrawnKind = "trackball" | "touchpad";
export type HandKinds = { left: DrawnKind | null; right: DrawnKind | null };

/**
 * The device drawn on each hand: the review params' choice, else what the board
 * detected. A trackpoint, a hand still detecting, or an unknown module draws
 * nothing (and says nothing).
 */
export function usePointingKinds(): HandKinds {
    const slots = usePointingSlots();
    const demo = pointingDemo();
    return useMemo(() => {
        const out: HandKinds = { left: null, right: null };
        for (const side of ["left", "right"] as const) {
            const asked = demo?.[side];
            if (asked) { out[side] = asked === "none" ? null : asked; continue; }
            const kind = slots.find((s) => s.side === side)?.kind;
            out[side] = kind === "trackball" || kind === "touchpad" ? kind : null;
        }
        return out;
    }, [slots, demo]);
}

/** A feed that replays reports to its listeners. */
export class ReportFeed implements PointingFeed {
    private listeners = new Set<(r: PointingMotionReport, dtMs: number) => void>();
    subscribe(listener: (r: PointingMotionReport, dtMs: number) => void) {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }
    push(r: PointingMotionReport, dtMs: number) {
        for (const l of [...this.listeners]) l(r, dtMs);
    }
    get size() { return this.listeners.size; }
}

/** The demo script as a feed: about 60 reports a second while the page is visible. */
export function startDemoFeed(d: PointingDemo, feed: ReportFeed): () => void {
    let t = 0, last = 0, raf = 0;
    const tick = (now: number) => {
        const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
        last = now;
        const t1 = t + dt;
        feed.push(demoReport(d, t, t1), dt * 1000);
        t = t1;
        raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
}

export interface PointingLive {
    feed: PointingFeed | null;
    sniper: boolean;
    boost: boolean;
    /** Where the motion comes from: the board (0x2D), the demo script, or nothing. */
    source: "board" | "demo" | "none";
}

/**
 * Motion and modes for the drawn devices: the board's POINTING_MOTION when it
 * reports it (read only, while this page is visible), else the review params'
 * scripted motion. ?sniper=1 / ?boost=1 hold a mode on over either.
 */
export function usePointingLive(active: boolean): PointingLive {
    const { keyboard, isConnected, connectionSessionId } = useKeyboard();
    const demo = pointingDemo();
    const live = getPointingLive();
    const supported = active && isConnected && keyboardService.hasPointingMotion(keyboard);
    const feed = useMemo(() => new ReportFeed(), []);
    const [modes, setModes] = useState({ sniper: false, boost: false });

    useEffect(() => { live.setConnection(keyboard ?? null, isConnected, connectionSessionId); }, [live, keyboard, isConnected, connectionSessionId]);

    useEffect(() => {
        if (!supported) return;
        const release = live.acquire();
        const off = live.subscribe((r, dt) => {
            feed.push(r, dt);
            setModes((m) => (m.sniper === r.sniper && m.boost === r.boost ? m : { sniper: r.sniper, boost: r.boost }));
        });
        return () => { off(); release(); };
    }, [supported, live, feed]);

    const scripted = active && !supported && !!(demo?.motion || demo?.velocity);
    useEffect(() => {
        if (!scripted || !demo) return;
        return startDemoFeed(demo, feed);
    }, [scripted, demo, feed]);

    return {
        feed: supported || scripted ? feed : null,
        sniper: (supported && modes.sniper) || !!demo?.sniper,
        boost: (supported && modes.boost) || !!demo?.boost,
        source: supported ? "board" : scripted ? "demo" : "none",
    };
}
