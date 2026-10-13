import { useEffect, useMemo, useRef, useState } from "react";

import type { PointingModuleKind, PointingSensor } from "@/components/pointing-viz/types";
import { useKeyboard } from "@/contexts/KeyboardContext";
import { widgetInstanceIndices, type ComposedWidget } from "@/services/fragment-composer.service";
import { keyboardService } from "@/services/keyboard.service";
import type { KeyboardInfo } from "@/types/keyboard.types";

// The board probes its pointing modules about 1.5 s after boot, and the other
// half's module arrives over the split link later, so 0x18 at connect can still
// say "not settled" for a slot. Re-read until every slot has settled, for a few
// seconds at most (same budget as usePointingHardware). Kept in hook state, not
// the keyboard draft: it's board state, and a change there would read as an edit.
export const POINTING_SLOT_RETRY_MS = 1000;
export const POINTING_SLOT_MAX_READS = 6;

export interface PointingSlotState extends ComposedWidget {
    kind: PointingModuleKind;
    sensor?: PointingSensor;
    /** The fragment's description, e.g. "PMW3360 trackball". */
    description?: string;
}

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
 * Empty when disconnected or when the definition has no pointing instances.
 * A hand detected with no module has no slot.
 */
export function usePointingSlots(): PointingSlotState[] {
    const { keyboard, isConnected, connectionSessionId } = useKeyboard();
    const [polled, setPolled] = useState<{ session: number; hw: Map<number, number>; done: boolean }>();
    const keyboardRef = useRef(keyboard);
    keyboardRef.current = keyboard;

    const hasWidgets = !!keyboard && widgetInstanceIndices(keyboard).size > 0;
    const atConnect = keyboard?.fragmentState?.hwDetection;

    useEffect(() => {
        if (!isConnected || !hasWidgets) return;
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
    }, [isConnected, connectionSessionId, hasWidgets]);

    const current = polled?.session === connectionSessionId ? polled : undefined;
    const hw = current?.hw ?? atConnect;

    return useMemo(() => {
        if (!isConnected || !keyboard || !hasWidgets) return [];
        return composeSlots(keyboard, toMap(hw))
            .map((slot) => toSlotState(keyboard, slot))
            .filter((slot) => slot.kind !== "none");
        // keyboard identity changes on every edit; the parts used here are listed.
    }, [isConnected, hasWidgets, hw, keyboard?.composition, keyboard?.fragments, keyboard?.fragmentState, keyboard?.cols]);
}

function toSlotState(kb: KeyboardInfo, slot: ComposedWidget): PointingSlotState {
    // Not reported yet, or never (the other half may be on older firmware or
    // unplugged): a neutral placeholder, never "no module".
    if (!slot.widget) return { ...slot, kind: "pending" };
    return {
        ...slot,
        kind: slot.widget.module,
        sensor: slot.widget.sensor,
        description: slot.fragmentName ? kb.fragments?.[slot.fragmentName]?.description : undefined,
    };
}
