import { useEffect, useRef } from "react";

import { keyboardService } from "@/services/keyboard.service";
import {
    PointingDetectPoller,
    withPointingDetection,
    type PointingDetectDeps,
} from "@/services/pointing-detect.service";
import type { KeyboardInfo } from "@/types/keyboard.types";

export const boardPointingDeps: PointingDetectDeps = {
    async readHardwareDetection(kbinfo) {
        const fragments = keyboardService.getFragmentService();
        if (!fragments.hasFragments(kbinfo)) return null;
        return fragments.readHardwareDetection();
    },
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
 * module, and writes what it finds into fragmentState.hwDetection. The Hardware
 * rows, the composition and the drawn devices read it from the keyboard. The
 * mismatch dialog reads pointing_hardware, which stays as read at connect.
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
