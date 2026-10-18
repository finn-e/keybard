import { useEffect, useRef } from "react";

import { MIN_SVIL_PROTO } from "@/constants/firmware";
import { useChanges } from "@/contexts/ChangesContext";
import { useKeyboard } from "@/contexts/KeyboardContext";
import { keyboardService } from "@/services/keyboard.service";
import { repairTapdances } from "@/utils/tapdance-term";

/**
 * Once per connect, writes every tap dance the board can't use as stored: a
 * term below the minimum (unused slots are stored as 0) becomes the default,
 * and a configured tap dance stored off is written on. The writes take the
 * normal path, so they save at once in live mode and wait as pending changes
 * otherwise.
 */
export function useTapdanceRepair(): void {
    const { keyboard, setKeyboard, isConnected, connectionState, connectionSessionId } = useKeyboard();
    const { queue, commit, isInstant } = useChanges();
    const repairedSession = useRef<number | string | null>(null);

    useEffect(() => {
        if (!isConnected || connectionState !== "connected" || !keyboard) return;
        if (repairedSession.current === connectionSessionId) return;
        repairedSession.current = connectionSessionId;

        // Tap dance writes need the Sval tap dance table, which Sval protocol 3 and later have.
        if (!keyboard.tapdance_count || !keyboard.tapdances?.length) return;
        if (!keyboard.svil_proto || keyboard.svil_proto < MIN_SVIL_PROTO) return;

        const repair = repairTapdances(keyboard.tapdances);
        if (!repair.changed.length) return;

        const updated = { ...keyboard, tapdances: repair.tapdances };
        setKeyboard(updated);
        console.log(`[Tap dance] ${repair.terms.length} term(s) below the minimum set to the default; ${repair.enabled.length} configured tap dance(s) turned on.`);

        void (async () => {
            for (const idx of repair.changed) {
                await queue(`tapdance ${idx}`, () => keyboardService.updateTapdance(updated, idx),
                    { type: "tapdance", tapdanceId: idx, writeKey: `tapdance:${idx}`, deferCommit: true });
            }
            await queue("Save tap dances", () => keyboardService.saveSvil(), { type: "tapdance", writeKey: "save-svil", deferCommit: true });
            if (isInstant) await commit();
        })().catch(error => console.warn("[Tap dance] Could not write repaired tap dances:", error));
    }, [isConnected, connectionState, connectionSessionId, keyboard, setKeyboard, queue, commit, isInstant]);
}
