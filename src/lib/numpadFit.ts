/**
 * The side panel's numpad: a 7-column grid that always fits its column.
 * Each cell takes the canvas key size when there is room and shrinks to
 * the column otherwise, never below NUMPAD_MIN_CELL_PX, so the numpad
 * never scrolls sideways.
 */
export type NumpadVariant = "default" | "medium" | "small";

export const NUMPAD_COLUMNS = 7;
export const NUMPAD_GAP_PX = 4;
export const NUMPAD_MIN_CELL_PX = 24;

/** The canvas key size each variant draws at. */
export const NUMPAD_VARIANT_PX: Record<NumpadVariant, number> = { default: 60, medium: 45, small: 30 };

/** One cell's size for a column `width` px wide (unmeasured: the key size itself). */
export function numpadCellSize(width: number | null | undefined, keySize: number): number {
    if (!width || width <= 0) return keySize;
    const fit = Math.floor((width - (NUMPAD_COLUMNS - 1) * NUMPAD_GAP_PX) / NUMPAD_COLUMNS);
    return Math.max(NUMPAD_MIN_CELL_PX, Math.min(keySize, fit));
}

/** The key variant a cell can hold: never larger than the canvas variant. */
export function numpadVariantFor(cell: number, keyVariant: NumpadVariant): NumpadVariant {
    const fits: NumpadVariant = cell >= NUMPAD_VARIANT_PX.default ? "default" : cell >= NUMPAD_VARIANT_PX.medium ? "medium" : "small";
    return NUMPAD_VARIANT_PX[fits] < NUMPAD_VARIANT_PX[keyVariant] ? fits : keyVariant;
}
