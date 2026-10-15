import { keyService } from "@/services/key.service";
import { ComboOptions, type ComboEntry } from "@/types/keyboard.types";

/** One combo a key takes part in. */
export interface ComboMembership {
    /** Combo slot (what the Combos panel calls "Combo N"). This is the combo's global order. */
    index: number;
    /** Enabled in firmware (options bit 15). Disabled combos are still shown, dimmed. */
    enabled: boolean;
    /** Output keycode string, e.g. "KC_ESC". */
    output: string;
    /** Trigger keycode strings, KC_NO removed. Never empty. */
    inputs: string[];
}

export type ComboMembershipIndex = Map<number, ComboMembership[]>;

const KC_NO = 0;
const KC_TRNS = 1;

/** Trigger keycodes of a combo, KC_NO removed. */
export function comboInputs(combo: ComboEntry | undefined): string[] {
    return (combo?.keys || []).filter(k => !!k && k !== "KC_NO");
}

/** Numeric trigger codes of a combo, so aliases (KC_ENT / KC_ENTER) match. KC_NO and KC_TRNS are never triggers. */
export function comboTriggerCodes(combo: ComboEntry | undefined): Set<number> {
    const out = new Set<number>();
    for (const k of comboInputs(combo)) {
        const code = Number(keyService.parse(k));
        if (Number.isInteger(code) && code > KC_TRNS && code <= 0xffff) out.add(code);
    }
    return out;
}

/**
 * Keycode -> the combos it triggers, each list ascending by combo index (the global order).
 * Firmware matches the full trigger code, so mod-taps are not reduced to their tap key, and
 * outputs are not indexed. Combos with no trigger keys are skipped.
 */
export function buildComboMembershipIndex(combos: ComboEntry[] = []): ComboMembershipIndex {
    const index: ComboMembershipIndex = new Map();
    combos.forEach((combo, slot) => {
        const codes = comboTriggerCodes(combo);
        if (!codes.size) return;
        const membership: ComboMembership = {
            index: slot,
            enabled: !!(combo.options & ComboOptions.ENABLED),
            output: combo.output,
            inputs: comboInputs(combo),
        };
        for (const code of codes) {
            const list = index.get(code) ?? [];
            list.push(membership);
            index.set(code, list);
        }
    });
    // Slots are visited in ascending order, so every list is already sorted; keep it explicit.
    for (const list of index.values()) list.sort((a, b) => a.index - b.index);
    return index;
}

/**
 * The keycode whose combos a key shows: its own, or for a transparent key above layer 0 the
 * key it falls through to. KC_NO and KC_TRNS show nothing.
 */
export function membershipCode(keycode: number, inherited: number | undefined): number {
    const code = keycode === KC_TRNS ? (inherited ?? KC_NO) : keycode;
    return code === KC_TRNS ? KC_NO : code;
}
