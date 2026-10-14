/** Where the single-combo editor sits while keys are picked on the keyboard. */
export type ComboEditorPlacement = "dock" | "anchored" | "float";

export const COMBO_EDITOR_PLACEMENT_SETTING = "combo-editor-placement";
export const COMBO_EDITOR_PLACEMENT_PARAM = "comboEditor";
export const DEFAULT_COMBO_EDITOR_PLACEMENT: ComboEditorPlacement = "dock";
export const COMBO_EDITOR_PLACEMENTS: readonly ComboEditorPlacement[] = ["dock", "anchored", "float"];

export const isComboEditorPlacement = (value: unknown): value is ComboEditorPlacement =>
    typeof value === "string" && (COMBO_EDITOR_PLACEMENTS as readonly string[]).includes(value);

/**
 * Resolve the placement. A valid `?comboEditor=` value is a review override for
 * this page load only and is never saved; otherwise the saved setting decides.
 */
export function resolveComboEditorPlacement(
    search: string,
    setting: unknown,
): { placement: ComboEditorPlacement; fromUrl: boolean } {
    let fromQuery: string | null = null;
    try {
        fromQuery = new URLSearchParams(search).get(COMBO_EDITOR_PLACEMENT_PARAM);
    } catch {
        fromQuery = null;
    }
    if (isComboEditorPlacement(fromQuery)) return { placement: fromQuery, fromUrl: true };
    return {
        placement: isComboEditorPlacement(setting) ? setting : DEFAULT_COMBO_EDITOR_PLACEMENT,
        fromUrl: false,
    };
}
