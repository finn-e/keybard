import { useEffect, useState } from "react";

import { useKeyboard } from "@/contexts/KeyboardContext";
import { keyboardService } from "@/services/keyboard.service";
import { isPointingReportSettled, type PointingHardwareReport } from "@/utils/pointing-hardware";

// The board probes for a module about 1.5 s after boot and the other half reports
// over the split link every half second, so the read at connect can come back
// incomplete. Read again until both halves have settled, for a few seconds at most.
// Kept out of the keyboard draft: it's board state, and a change there would read
// as an unsaved edit.
export const POINTING_RETRY_MS = 1000;
export const POINTING_MAX_READS = 6;

/** Each half's pointing hardware, re-read after connect until both halves have reported. */
export function usePointingHardware(): PointingHardwareReport | undefined {
    const { keyboard, isConnected, connectionSessionId } = useKeyboard();
    const [polled, setPolled] = useState<{ session: number; report: PointingHardwareReport }>();
    const atConnect = keyboard?.pointing_hardware;

    useEffect(() => {
        if (!isConnected || !keyboard || isPointingReportSettled(atConnect)) return;
        let active = true;
        let timer: number | undefined;
        let reads = 0;
        const read = async () => {
            const probe = { ...keyboard };
            await keyboardService.getPointingHardware(probe);
            if (!active) return;
            const report = probe.pointing_hardware;
            if (report) setPolled({ session: connectionSessionId, report });
            if (++reads < POINTING_MAX_READS && !isPointingReportSettled(report)) timer = window.setTimeout(read, POINTING_RETRY_MS);
        };
        timer = window.setTimeout(read, POINTING_RETRY_MS);
        return () => {
            active = false;
            window.clearTimeout(timer);
        };
        // Once per connection: keyboard changes with every edit.
    }, [isConnected, connectionSessionId, !!keyboard]);

    if (!isConnected) return undefined;
    return polled?.session === connectionSessionId ? polled.report : atConnect;
}
