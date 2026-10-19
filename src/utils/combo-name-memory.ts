// Combo names remembered in this browser, so a name survives a reload of an
// offline layout (the demo, a file) as well as of a connected board. A name is
// remembered by what its combo does (keys, output, on/off), the same rule the
// backups use, so it comes back only on a combo that still does that. Files
// and boards that carry their own names keep them; the memory fills in the
// combos that have none (and, for the demo, replaces its example names).
import { appStorage } from "@/utils/app-storage";
import { comboName, comboShape } from "@/utils/combo-names";
import type { ComboEntry, KeyboardInfo } from "@/types/keyboard.types";

export const COMBO_NAME_MEMORY_KEY = "keybard-combo-names";
/** Oldest entries go first past this many. */
const MAX_ENTRIES = 500;

/** Shape -> name. An empty name records "no name", for layouts whose own names it replaces. */
type Memory = Record<string, string>;

function read(): Memory {
    try {
        const raw = appStorage.getItem(COMBO_NAME_MEMORY_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

function write(memory: Memory) {
    try {
        const keys = Object.keys(memory);
        const trimmed = keys.length > MAX_ENTRIES
            ? Object.fromEntries(keys.slice(keys.length - MAX_ENTRIES).map(k => [k, memory[k]]))
            : memory;
        appStorage.setItem(COMBO_NAME_MEMORY_KEY, JSON.stringify(trimmed));
    } catch {
        // Storage full or blocked: names still live in files and backups.
    }
}

/** A combo that does nothing has no identity to remember a name by. */
function isEmpty(combo: ComboEntry | undefined): boolean {
    if (!combo) return true;
    const none = (k: unknown) => k === undefined || k === null || k === "KC_NO" || k === 0 || k === "";
    return (combo.keys ?? []).every(none) && none(combo.output);
}

const shapeOf = (combo: ComboEntry | undefined) => (isEmpty(combo) ? null : comboShape(combo));

/**
 * Record what changed between two versions of a layout: a named combo's name
 * under its current shape, a removed name as "no name", and a renamed or
 * reshaped combo's old entry dropped. Does nothing when nothing changed.
 */
export function rememberComboNames(previous: KeyboardInfo | null | undefined, next: KeyboardInfo | null | undefined) {
    if (!next?.combos) return;
    const memory = read();
    let changed = false;
    const set = (shape: string, name: string) => {
        if (memory[shape] === name) return;
        delete memory[shape]; // re-insert last, so it is the newest
        memory[shape] = name;
        changed = true;
    };
    next.combos.forEach((combo, index) => {
        const shape = shapeOf(combo);
        const name = comboName(next.cosmetic, index) ?? "";
        const before = previous?.combos?.[index];
        const oldShape = shapeOf(before);
        const oldName = previous ? comboName(previous.cosmetic, index) ?? "" : undefined;
        if (oldShape && oldShape !== shape && oldName && memory[oldShape] === oldName) {
            delete memory[oldShape];
            changed = true;
        }
        if (!shape) return;
        if (name) set(shape, name);
        // Only a name the person removed is recorded as "no name".
        else if (oldName && oldShape === shape) set(shape, "");
    });
    if (changed) write(memory);
}

/**
 * The layout with remembered names put back. By default a combo's own name
 * wins; `replace` (the demo) lets remembered names, and removals, win.
 */
export function recallComboNames(kb: KeyboardInfo, { replace = false }: { replace?: boolean } = {}): KeyboardInfo {
    if (!kb.combos?.length) return kb;
    const memory = read();
    if (!Object.keys(memory).length) return kb;
    const names: Record<string, string> = { ...kb.cosmetic?.combos };
    let changed = false;
    kb.combos.forEach((combo, index) => {
        const shape = shapeOf(combo);
        if (!shape || !(shape in memory)) return;
        const own = comboName(kb.cosmetic, index);
        if (own && !replace) return;
        const remembered = memory[shape].trim();
        if (remembered === (own ?? "")) return;
        if (remembered) names[String(index)] = remembered;
        else delete names[String(index)];
        changed = true;
    });
    return changed ? { ...kb, cosmetic: { ...kb.cosmetic, combos: names } } : kb;
}
