import { useEffect, useMemo, useRef, useState } from "react";

import type { PointingModuleKind, PointingSensor } from "@/components/pointing-viz/types";
import { useKeyboard } from "@/contexts/KeyboardContext";
import { pointingDemoTourModule, POINTING_DEMO_TOUR_MS } from "@/components/pointing-viz/simulate";
import { pointingVizEnabled } from "@/features/pointing-viz-flag";
import { readPointingDemo } from "@/hooks/usePointingLive";
import { fitPointingPocket, widgetInstanceIndices, type ComposedWidget } from "@/services/fragment-composer.service";
import { keyboardService } from "@/services/keyboard.service";
import type { FragmentWidget, KeyboardInfo } from "@/types/keyboard.types";

// The board probes its pointing modules about 1.5 s after boot, and the other
// half's module arrives over the split link later, so 0x18 at connect can still
// say "not settled" for a slot. Re-read until every slot has settled, for a few
// seconds at most (same budget as usePointingHardware). Kept in hook state, not
// the keyboard draft: it's board state, and a change there would read as an edit.
export const POINTING_SLOT_RETRY_MS = 1000;
export const POINTING_SLOT_MAX_READS = 6;

/** Demo-mode positions (composed key units) when the definition has no pointing instances and its pocket can't be found. */
export const POINTING_SLOT_FALLBACK = {
    left: { x: 4.5, y: 4.75, w: 2.5, h: 2.5 },
    right: { x: 18, y: 4.75, w: 2.5, h: 2.5 },
} as const;

export interface PointingSlotState extends ComposedWidget {
    kind: PointingModuleKind;
    sensor?: PointingSensor;
    /** The fragment's description, e.g. "PMW3360 trackball". */
    description?: string;
    /** Simulated (?pointingDemo=...), not detected. */
    demo?: boolean;
}

const DEMO_SIZE = 2.5;

function toMap(m: Map<number, number> | Record<string, number> | undefined): Map<number, number> {
    if (!m) return new Map();
    if (m instanceof Map) return m;
    return new Map(Object.entries(m).map(([k, v]) => [Number(k), v]));
}

function composeSlots(kb: KeyboardInfo, hw: Map<number, number>): ComposedWidget[] {
    try {
        return keyboardService.getFragmentComposer().composeWidgets(kb, hw);
    } catch (e) {
        console.warn("Failed to compose pointing slots:", e);
        return [];
    }
}

const isSettled = (slots: ComposedWidget[]) => slots.every((s) => s.widget !== null);

/**
 * One slot per hand whose definition has a pointing instance (left_pointing /
 * right_pointing), with the module hardware detection (0x18) reports for it.
 * Empty when disconnected or when the definition has no pointing instances,
 * except in demo mode (?pointingDemo=...), which always shows both hands.
 * Always empty while the pointing-viz flag is off (features/pointing-viz-flag.ts).
 */
export function usePointingSlots(): PointingSlotState[] {
    const { keyboard, isConnected, connectionSessionId } = useKeyboard();
    const enabled = useMemo(pointingVizEnabled, []);
    const demo = useMemo(() => (enabled ? readPointingDemo() : null), [enabled]);
    const [polled, setPolled] = useState<{ session: number; hw: Map<number, number>; done: boolean }>();
    const keyboardRef = useRef(keyboard);
    keyboardRef.current = keyboard;

    // Demo tour: step every hand to its next module on a timer.
    const [tourStep, setTourStep] = useState(0);
    useEffect(() => {
        if (!demo?.tour) return;
        const timer = window.setInterval(() => setTourStep((s) => s + 1), POINTING_DEMO_TOUR_MS);
        return () => window.clearInterval(timer);
    }, [demo]);

    const hasWidgets = !!keyboard && widgetInstanceIndices(keyboard).size > 0;
    const atConnect = keyboard?.fragmentState?.hwDetection;

    useEffect(() => {
        if (!enabled || demo || !isConnected || !hasWidgets) return;
        const kb = keyboardRef.current;
        if (!kb || isSettled(composeSlots(kb, toMap(atConnect)))) {
            setPolled({ session: connectionSessionId, hw: toMap(atConnect), done: true });
            return;
        }
        let active = true;
        let timer: number | undefined;
        let reads = 0;
        const read = async () => {
            const current = keyboardRef.current;
            if (!current) return;
            const hw = await keyboardService.getFragmentHardware(current);
            if (!active) return;
            reads++;
            const settled = isSettled(composeSlots(current, hw));
            const done = settled || reads >= POINTING_SLOT_MAX_READS;
            setPolled({ session: connectionSessionId, hw, done });
            if (!done) timer = window.setTimeout(read, POINTING_SLOT_RETRY_MS);
        };
        timer = window.setTimeout(read, POINTING_SLOT_RETRY_MS);
        return () => {
            active = false;
            window.clearTimeout(timer);
        };
        // Once per connection: keyboard changes with every edit.
    }, [enabled, demo, isConnected, connectionSessionId, hasWidgets]);

    const current = polled?.session === connectionSessionId ? polled : undefined;
    const hw = current?.hw ?? atConnect;
    const done = current?.done ?? false;

    return useMemo(() => {
        if (!enabled) return [];
        if (demo) {
            const step = demo.tour
                ? { ...demo, left: pointingDemoTourModule("left", tourStep), right: pointingDemoTourModule("right", tourStep) }
                : demo;
            return demoSlots(keyboard, step);
        }
        if (!isConnected || !keyboard || !hasWidgets) return [];
        return composeSlots(keyboard, toMap(hw)).map((slot) => toSlotState(keyboard, slot, done));
        // keyboard identity changes on every edit; the parts used here are listed.
    }, [enabled, demo, tourStep, isConnected, hasWidgets, hw, done, keyboard?.composition, keyboard?.fragments, keyboard?.fragmentState, keyboard?.cols]);
}

function toSlotState(kb: KeyboardInfo, slot: ComposedWidget, done: boolean): PointingSlotState {
    if (!slot.widget) return { ...slot, kind: done ? "none" : "pending" };
    return {
        ...slot,
        kind: slot.widget.module,
        sensor: slot.widget.sensor,
        description: slot.fragmentName ? kb.fragments?.[slot.fragmentName]?.description : undefined,
    };
}

function fitPocket(kb: KeyboardInfo, side: "left" | "right") {
    try {
        return fitPointingPocket(kb, keyboardService.getFragmentComposer().composeLayout(kb), side);
    } catch {
        return null;
    }
}

function demoSlots(kb: KeyboardInfo | null, demo: NonNullable<ReturnType<typeof readPointingDemo>>): PointingSlotState[] {
    const fromDefinition = kb && widgetInstanceIndices(kb).size > 0 ? composeSlots(kb, new Map()) : [];
    const instanceIds = new Set((kb?.composition?.instances ?? []).map((i) => i.id));
    const useFallback = fromDefinition.length === 0 && instanceIds.has("left_thumb") && instanceIds.has("right_thumb");
    if (fromDefinition.length === 0 && !useFallback) return [];

    return (["left", "right"] as const).flatMap((side, i) => {
        const composed = fromDefinition.find((s) => s.side === side);
        if (fromDefinition.length > 0 && !composed) return [];
        const pocket = composed || !kb ? null : fitPocket(kb, side);
        const pos = composed ?? { ...(pocket ?? POINTING_SLOT_FALLBACK[side]), instanceIdx: -1 - i, instanceId: `${side}_pointing` };
        const module = demo[side];
        const widget: FragmentWidget = { kind: "pointing", module, w: pos.w || DEMO_SIZE, h: pos.h || DEMO_SIZE };
        return [{
            instanceIdx: pos.instanceIdx,
            instanceId: pos.instanceId,
            side,
            fragmentName: null,
            widget,
            x: pos.x,
            y: pos.y,
            w: widget.w,
            h: widget.h,
            kind: module,
            demo: true,
        }];
    });
}
