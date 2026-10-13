import { useEffect, useMemo, useState } from "react";

import { createSimulatedSource, parsePointingDemo, type SimulatedSource, type SimulatedModule, type PointingDemoConfig } from "@/components/pointing-viz/simulate";
import type { PointingModuleKind, PointingSampleSource, PointingSide } from "@/components/pointing-viz/types";
import { useKeyboard } from "@/contexts/KeyboardContext";
import { keyboardService } from "@/services/keyboard.service";
import { getPointingLive } from "@/services/pointing-live.service";

/** The demo config from the page URL (?pointingDemo=...), or null. */
export function readPointingDemo(): PointingDemoConfig | null {
    if (typeof window === "undefined") return null;
    return parsePointingDemo(window.location.search);
}

// Demo sources, one per side per page, shared by every slot showing that side.
const demoSources = new Map<string, { source: SimulatedSource; refs: number }>();

function acquireDemoSource(demo: PointingDemoConfig, side: PointingSide, kind: SimulatedModule): { source: SimulatedSource; release: () => void } | null {
    if (kind === "none") return null;
    const key = `${side}:${kind}:${demo.mode ?? "cycle"}`;
    let entry = demoSources.get(key);
    if (!entry) {
        entry = { source: createSimulatedSource(kind, side, demo.mode ? { mode: demo.mode } : {}), refs: 0 };
        demoSources.set(key, entry);
    }
    entry.refs++;
    const held = entry;
    let released = false;
    return {
        source: held.source,
        release: () => {
            if (released) return;
            released = true;
            if (--held.refs <= 0) {
                held.source.stop();
                demoSources.delete(key);
            }
        },
    };
}

function toSimulated(kind: PointingModuleKind): SimulatedModule {
    return kind === "trackball" || kind === "touchpad" || kind === "trackpoint" ? kind : "none";
}

/**
 * The motion stream for one hand's pointing slot: simulated in demo mode, or
 * the shared POINTING_MOTION (0x2D) poller while `enabled` and connected.
 * Null when the board doesn't report motion; the slot then shows a still icon.
 * `demoKind` is the module a demo slot currently shows (a demo tour changes it);
 * without it the URL's module for that side is used.
 */
export function usePointingLive(side: PointingSide, enabled: boolean, demoKind?: PointingModuleKind): PointingSampleSource | null {
    const demo = useMemo(readPointingDemo, []);
    const { keyboard, isConnected, connectionSessionId } = useKeyboard();
    const [demoSource, setDemoSource] = useState<PointingSampleSource | null>(null);
    const live = getPointingLive();

    // Demo: hold the shared simulated source while mounted.
    const kind: SimulatedModule | null = demo ? toSimulated(demoKind ?? demo[side]) : null;
    useEffect(() => {
        if (!demo || !enabled || !kind) return;
        const held = acquireDemoSource(demo, side, kind);
        setDemoSource(held?.source ?? null);
        return () => {
            held?.release();
            setDemoSource(null);
        };
    }, [demo, side, enabled, kind]);

    // Live: point the poller at the board (it resets on a new session or a disconnect).
    useEffect(() => {
        if (demo) return;
        live.setConnection(keyboard ?? null, isConnected, connectionSessionId);
    }, [demo, live, keyboard, isConnected, connectionSessionId]);

    const supported = !demo && isConnected && keyboardService.hasPointingMotion(keyboard);
    useEffect(() => {
        if (demo || !enabled || !supported) return;
        return live.acquire();
    }, [demo, enabled, supported, live]);

    if (demo) return enabled ? demoSource : null;
    return supported ? live.source(side) : null;
}
