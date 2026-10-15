/**
 * The binding editors (combo, tap dance, macro, key override, alt-repeat and
 * leader) share one picker. While one is open, the rail's picker categories
 * switch the picker panel and everything else waits until the editor closes.
 * This module is the one owner of which panel is an editor, which picker
 * categories each editor can use, and what a rail item does while editing.
 */

/** A picker panel the binding editor can fill a slot from. */
export type PickerMode = "keyboard" | "layers" | "macros" | "qmk" | "oneshot" | "special" | "mouse" | "pointing" | "tapdances";

/** Panels whose item editor uses the shared picker. */
export const BINDING_EDITOR_PANELS = ["tapdances", "combos", "macros", "overrides", "altrepeat", "leaders"] as const;
export type BindingEditorPanel = typeof BINDING_EDITOR_PANELS[number];

export const isBindingEditorPanel = (panel: string | null | undefined): panel is BindingEditorPanel =>
    !!panel && (BINDING_EDITOR_PANELS as readonly string[]).includes(panel);

/** True while a binding editor (and its picker) is open. */
export const isBindingEditorOpen = (activePanel: string | null | undefined, itemToEdit: number | null): boolean =>
    itemToEdit !== null && isBindingEditorPanel(activePanel);

/** Picker categories in rail order. Each one is also a rail item with the same id. */
export const PICKER_CATEGORIES: readonly { id: PickerMode; title: string }[] = [
    { id: "keyboard", title: "Standard Keys" },
    { id: "pointing", title: "Pointing Devices" },
    { id: "special", title: "Special Keys" },
    { id: "layers", title: "Layer Keys" },
    { id: "mouse", title: "Mouse Keys" },
    { id: "tapdances", title: "Tap Dance Keys" },
    { id: "macros", title: "Macro Keys" },
];

/** A category an editor cannot hold: a tap dance inside a tap dance, a macro inside a macro. */
const INVALID: Partial<Record<BindingEditorPanel, PickerMode[]>> = {
    tapdances: ["tapdances"],
    macros: ["macros"],
};

/** The picker categories an editor can use, in rail order. */
export function usablePickerCategories(editor: string | null | undefined): PickerMode[] {
    const invalid = isBindingEditorPanel(editor) ? INVALID[editor] ?? [] : [];
    return PICKER_CATEGORIES.map(c => c.id).filter(id => !invalid.includes(id));
}

/** The picker category a rail item switches to while this editor is open, or null when it is covered. */
export function pickerCategoryForRail(url: string, editor: string | null | undefined): PickerMode | null {
    return (usablePickerCategories(editor) as string[]).includes(url) ? url as PickerMode : null;
}

/** The category to show: the chosen one when the editor can use it, otherwise Standard Keys. */
export function effectivePickerMode(mode: PickerMode, editor: string | null | undefined): PickerMode {
    if (mode === "qmk" || mode === "oneshot") return mode;
    return (usablePickerCategories(editor) as string[]).includes(mode) ? mode : "keyboard";
}
