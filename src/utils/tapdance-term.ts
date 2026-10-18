import type { TapdanceEntry } from "@/types/keyboard.types";

/** The term a new tap dance starts with, in milliseconds. */
export const DEFAULT_TAPDANCE_TERM_MS = 200;
/** The shortest term a tap dance works with, in milliseconds. */
export const MIN_TAPDANCE_TERM_MS = 20;
/** The longest term the firmware stores (bits 0-14). */
export const MAX_TAPDANCE_TERM_MS = 32767;

/** A term the board can't use: missing, or below the minimum. A term of 0 breaks the tap dance. */
export function isUnusableTapdanceTerm(term: unknown): boolean {
    return typeof term !== "number" || !Number.isFinite(term) || term < MIN_TAPDANCE_TERM_MS;
}

/** A term within the limits the editor allows. */
export function clampTapdanceTerm(ms: number): number {
    return Math.max(MIN_TAPDANCE_TERM_MS, Math.min(MAX_TAPDANCE_TERM_MS, Math.round(ms)));
}

/** True when no action of the tap dance has a key. */
export function isTapdanceEmpty(td: Partial<Pick<TapdanceEntry, "tap" | "hold" | "doubletap" | "taphold">>): boolean {
    return [td.tap, td.hold, td.doubletap, td.taphold].every(key => !key || key === "KC_NO" || key === "0x0000");
}

export interface TapdanceRepair {
    /** The tap dances with the repaired entries replaced by copies. */
    tapdances: TapdanceEntry[];
    /** Indexes whose term was unusable (below the minimum, often 0). */
    terms: number[];
    /** Indexes of configured tap dances that were stored off. */
    enabled: number[];
    /** Every index that needs writing. */
    changed: number[];
}

/**
 * What a board's tap dances need written so they work: a usable term on every
 * slot, and every configured tap dance on. Writing sets the enabled bit.
 */
export function repairTapdances(tapdances: TapdanceEntry[]): TapdanceRepair {
    const terms: number[] = [];
    const enabled: number[] = [];
    const changed: number[] = [];
    const next = tapdances.map((td, i) => {
        if (!td) return td;
        const badTerm = isUnusableTapdanceTerm(td.tapping_term);
        const off = td.enabled === false && !isTapdanceEmpty(td);
        if (!badTerm && !off) return td;
        if (badTerm) terms.push(i);
        if (off) enabled.push(i);
        changed.push(i);
        return { ...td, tapping_term: usableTapdanceTerm(td.tapping_term), enabled: true };
    });
    return { tapdances: changed.length ? next : tapdances, terms, enabled, changed };
}

/** A term the board can use: the term itself, or the default in place of an unusable one. */
export function usableTapdanceTerm(term: unknown): number {
    return isUnusableTapdanceTerm(term) ? DEFAULT_TAPDANCE_TERM_MS : Math.round(term as number);
}
