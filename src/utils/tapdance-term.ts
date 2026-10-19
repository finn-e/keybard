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

/** A term the board can use: the term itself, or the default in place of an unusable one. */
export function usableTapdanceTerm(term: unknown): number {
    return isUnusableTapdanceTerm(term) ? DEFAULT_TAPDANCE_TERM_MS : Math.round(term as number);
}
