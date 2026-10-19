// On every connect: do the halves run different firmware? From STATUS presence and INFO
// flags bit5 on the half with USB (F9 / Q17). Quiet when the board has no updater.

import { useEffect, useState } from "react";

import { useKeyboard } from "@/contexts/KeyboardContext";
import { updateInFlight } from "@/services/updater/flow";
import { usbInstance } from "@/services/usb.service";
import { WebHidUpdaterTransport } from "@/services/updater/webhid-transport";
import { readBoardSummary, type BoardSummary } from "./board-summary";

/** Ask the app to open Settings > Firmware (FirmwareUpdateProvider listens). */
export const OPEN_FIRMWARE_EVENT = "keybard:open-firmware";

/** What the connected board runs, read once per connection, and again when `refresh` changes. */
export function useBoardSummary(refresh = 0): BoardSummary | null {
    const { isConnected, keyboard, connectionSessionId } = useKeyboard();
    const [summary, setSummary] = useState<{ session: number; refresh: number; board: BoardSummary } | null>(null);
    const loaded = isConnected && !!keyboard;
    useEffect(() => {
        if (!loaded || updateInFlight()) return;
        let cancelled = false;
        const session = connectionSessionId;
        void readBoardSummary(new WebHidUpdaterTransport(usbInstance), keyboard)
            .then((board) => { if (!cancelled) setSummary({ session, refresh, board }); })
            .catch(() => undefined);
        return () => { cancelled = true; };
        // Once per connection (and per refresh), after the load.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loaded, connectionSessionId, refresh]);
    return loaded && summary?.session === connectionSessionId ? summary.board : null;
}
