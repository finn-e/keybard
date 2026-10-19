import { useMemo } from "react";

import type { PointingModuleKind, PointingSensor } from "@/components/pointing-viz/types";
import { useKeyboard } from "@/contexts/KeyboardContext";
import { widgetInstanceIndices, type ComposedWidget } from "@/services/fragment-composer.service";
import { keyboardService } from "@/services/keyboard.service";
import type { KeyboardInfo } from "@/types/keyboard.types";

// A module the board finds after connect reaches fragmentState.hwDetection
// through the late-detection poller (usePointingDetection, run by
// KeyboardProvider), so the slots just follow the keyboard.

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

/**
 * One slot per hand whose definition has a pointing instance (left_pointing /
 * right_pointing), with the module hardware detection (0x18) reports for it.
 * Empty when disconnected or when the definition has no pointing instances.
 * A hand detected with no module has no slot.
 */
export function usePointingSlots(): PointingSlotState[] {
    const { keyboard, isConnected } = useKeyboard();
    const hasWidgets = !!keyboard && widgetInstanceIndices(keyboard).size > 0;
    const hw = keyboard?.fragmentState?.hwDetection;

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
