// Combo names: kept in Keybard only (keyboard.cosmetic.combos, keyed by the
// combo index as a string), saved in .svil files and local backups. The board
// never stores them.
import { keyService } from "@/services/key.service";
import { ComboOptions, type ComboEntry, type KeyboardInfo } from "@/types/keyboard.types";

type Cosmetic = KeyboardInfo["cosmetic"];

/** Combo `index`'s name, or undefined when it has none. */
export function comboName(cosmetic: Cosmetic | undefined, index: number): string | undefined {
    const name = cosmetic?.combos?.[String(index)]?.trim();
    return name ? name : undefined;
}

/** What a combo does, for comparing two versions of it: its four slots, output and on/off. */
export function comboShape(combo: ComboEntry | undefined): string | null {
    if (!combo) return null;
    const code = (k: string | number | undefined) => {
        const n = Number(keyService.parse(k ?? "KC_NO"));
        return Number.isFinite(n) ? n : String(k);
    };
    const slots = [0, 1, 2, 3].map(i => code(combo.keys?.[i]));
    const enabled = ((combo.options ?? 0) & ComboOptions.ENABLED) !== 0;
    return JSON.stringify([slots, code(combo.output), enabled]);
}

/** Do two versions of a combo do the same thing (keys, output, on/off)? */
export function sameCombo(a: ComboEntry | undefined, b: ComboEntry | undefined): boolean {
    const s = comboShape(a);
    return s !== null && s === comboShape(b);
}

/** The combos and combo names in a backup's .svil text, without loading the whole layout. */
export function comboNamesFromSvil(svil: string): KeyboardInfo | null {
    const js = JSON.parse(svil);
    if (!js || typeof js !== "object") return null;
    const combos: ComboEntry[] = (Array.isArray(js.combo) ? js.combo : []).map((c: any, cmbid: number) => ({
        cmbid,
        keys: Array.isArray(c?.keys) ? c.keys : [],
        output: c?.output ?? "KC_NO",
        options: ((c?.combo_term ?? 0) & 0x7fff) | (c?.on !== false ? ComboOptions.ENABLED : 0),
    }));
    const names = js.cosmetic?.combos;
    return { combos, cosmetic: names && typeof names === "object" ? { combos: names } : undefined } as KeyboardInfo;
}

/**
 * Names to restore on connect from the board's latest backup. A name is kept
 * only where that combo's keys, output and on/off are unchanged on the board,
 * so a combo that was changed somewhere else never shows a stale name. Names
 * the board's keyboard already has win. Returns null when nothing is restored.
 */
export function seedComboNames(backup: KeyboardInfo | null | undefined, current: KeyboardInfo): Record<string, string> | null {
    const saved = backup?.cosmetic?.combos;
    if (!saved) return null;
    const out: Record<string, string> = {};
    const count = current.combos?.length ?? 0;
    for (const [key, raw] of Object.entries(saved)) {
        const index = Number(key);
        const name = typeof raw === "string" ? raw.trim() : "";
        if (!name || !Number.isInteger(index) || index < 0 || index >= count) continue;
        if (comboName(current.cosmetic, index)) continue;
        if (sameCombo(backup!.combos?.[index], current.combos?.[index])) out[key] = name;
    }
    return Object.keys(out).length ? out : null;
}
