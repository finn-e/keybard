// On every connect: do the halves run different firmware? From STATUS presence and INFO
// flags bit5 on the half with USB (F9 / Q17). Quiet when the board has no updater.

import { useEffect, useState } from "react";

import { useKeyboard } from "@/contexts/KeyboardContext";
import { updateInFlight } from "@/services/updater/flow";
import { usbInstance } from "@/services/usb.service";
import { WebHidUpdaterTransport } from "@/services/updater/webhid-transport";
import { readBoardSummary, type BoardSummary } from "./board-summary";

/** Ask the app to open Settings > Firmware (M3 wires the listener). */
export const OPEN_FIRMWARE_EVENT = "keybard:open-firmware";

export function useBoardSummary(): BoardSummary | null {
    const { isConnected, keyboard, connectionSessionId } = useKeyboard();
    const [summary, setSummary] = useState<{ session: number; board: BoardSummary } | null>(null);
    const loaded = isConnected && !!keyboard;
    useEffect(() => {
        if (!loaded || updateInFlight()) return;
        let cancelled = false;
        const session = connectionSessionId;
        void readBoardSummary(new WebHidUpdaterTransport(usbInstance), keyboard)
            .then((board) => { if (!cancelled) setSummary({ session, board }); })
            .catch(() => undefined);
        return () => { cancelled = true; };
        // Once per connection, after the load.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loaded, connectionSessionId]);
    return loaded && summary?.session === connectionSessionId ? summary.board : null;
}
