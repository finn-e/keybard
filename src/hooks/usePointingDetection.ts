import { useEffect, useRef } from "react";

import { keyboardService } from "@/services/keyboard.service";
import {
    PointingDetectPoller,
    withPointingDetection,
    type PointingDetectDeps,
} from "@/services/pointing-detect.service";
import type { KeyboardInfo } from "@/types/keyboard.types";
import { SVIL_FLAG2_POINTING_HARDWARE } from "@/utils/pointing-hardware";

export const boardPointingDeps: PointingDetectDeps = {
    async readHardwareDetection(kbinfo) {
        const fragments = keyboardService.getFragmentService();
        if (!fragments.hasFragments(kbinfo)) return null;
        return fragments.readHardwareDetection();
    },
    async readPointingHardware(kbinfo) {
        const probe = { ...kbinfo };
        await keyboardService.getPointingHardware(probe);
        return probe.pointing_hardware ?? null;
    },
    hasPointingHardware: (kbinfo) => ((kbinfo.feature_flags2 ?? 0) & SVIL_FLAG2_POINTING_HARDWARE) !== 0,
};

export interface PointingDetectionOptions {
    /** A board is connected and loaded. */
    connected: boolean;
    /** Changes on every load from the board; detection starts over on each. */
    boardLoad: number;
    getKeyboard: () => KeyboardInfo | null;
    /** Applies a change to the board state (the draft and the loaded copy). */
    apply: (patch: (kb: KeyboardInfo) => KeyboardInfo) => void;
    deps?: PointingDetectDeps;
}

/**
 * The one owner of late pointing detection, run by KeyboardProvider: after each
 * load from the board, it keeps re-reading while a hand shows "Detecting" or no
 * module, and writes what it finds into the keyboard. Everything else (the
 * Hardware rows, the mismatch dialog, the drawn devices) reads the keyboard.
 */
export function usePointingDetection({ connected, boardLoad, getKeyboard, apply, deps = boardPointingDeps }: PointingDetectionOptions) {
    const applyRef = useRef(apply);
    applyRef.current = apply;
    const getRef = useRef(getKeyboard);
    getRef.current = getKeyboard;

    useEffect(() => {
        if (!connected) return;
        const kbinfo = getRef.current();
        if (!kbinfo) return;
        const poller = new PointingDetectPoller(deps);
        poller.start(kbinfo, (update) => applyRef.current((kb) => withPointingDetection(kb, update)));
        return () => poller.stop();
    }, [connected, boardLoad, deps]);
}
