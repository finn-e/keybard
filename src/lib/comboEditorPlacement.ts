/**
 * Where the single-combo editor sits while keys are picked on the keyboard.
 * "half" is the compact card under the keyboard half that holds fewer of the
 * combo's keys; the others stay selectable for comparison. "panel" is the one
 * value that applies to every binding editor: the editor sits at the top of
 * the side panel, pinned above the picker, with no card over the layout.
 */
export type ComboEditorPlacement = "half" | "dock" | "anchored" | "float" | "panel";

export const COMBO_EDITOR_PLACEMENT_SETTING = "combo-editor-placement";
export const COMBO_EDITOR_PLACEMENT_PARAM = "comboEditor";
/** Fired when the fixed combo editor card moves, so the key inspector can re-measure its lane. */
export const COMBO_EDITOR_MOVED_EVENT = "keybard:combo-editor-moved";
export const DEFAULT_COMBO_EDITOR_PLACEMENT: ComboEditorPlacement = "half";
export const COMBO_EDITOR_PLACEMENTS: readonly ComboEditorPlacement[] = ["half", "dock", "anchored", "float", "panel"];

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

/** True when every binding editor sits in the side panel above the picker. */
export const isPanelEditorPlacement = (placement: ComboEditorPlacement | null | undefined): boolean => placement === "panel";

/** Picker height kept in view under an editor in the side panel, at most this share of the panel. */
export const PANEL_PICKER_ROOM_PX = 220;
const PANEL_PICKER_ROOM_SHARE = 0.4;

/**
 * Sticky top for the editor pinned at the top of the side panel. A short editor
 * pins at 0. A taller one pins with a negative top, so scrolling moves it up
 * just far enough to leave picker room below it; scrolling back shows all of it.
 */
export function pinnedEditorTop(viewportHeight: number, editorHeight: number): number {
    if (!(viewportHeight > 0) || !(editorHeight > 0)) return 0;
    const room = Math.min(PANEL_PICKER_ROOM_PX, viewportHeight * PANEL_PICKER_ROOM_SHARE);
    return Math.min(0, Math.round(viewportHeight - room - editorHeight));
}
