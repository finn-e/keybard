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
    typeof itemToEdit === "number" && isBindingEditorPanel(activePanel);

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

/** The open editor's name, as its header shows it ("Combo 3", a tap dance's own name). */
export function bindingEditorTitle(
    editor: string | null | undefined,
    index: number | null,
    cosmetic?: { macros?: Record<string, string>; tapdances?: Record<string, string> },
): string {
    if (index === null || !editor) return "the editor";
    switch (editor) {
        case "macros": return cosmetic?.macros?.[String(index)] || `Macro Key ${index}`;
        case "tapdances": return cosmetic?.tapdances?.[String(index)] || `Tap Dance Key ${index}`;
        case "combos": return `Combo ${index}`;
        case "overrides": return `Override ${index}`;
        case "altrepeat": return `Alt-Repeat Key ${index}`;
        case "leaders": return `Leader Sequence ${index}`;
        default: return "the editor";
    }
}

/** The open editor's kind and number, for the back-arrow callout ("Combo 0", "Tap Dance 2"). */
export function bindingEditorKind(editor: string | null | undefined, index: number | null): string {
    if (index === null || !editor) return "this editor";
    switch (editor) {
        case "macros": return `Macro ${index}`;
        case "tapdances": return `Tap Dance ${index}`;
        case "combos": return `Combo ${index}`;
        case "overrides": return `Override ${index}`;
        case "altrepeat": return `Alt-Repeat ${index}`;
        case "leaders": return `Leader ${index}`;
        default: return "this editor";
    }
}

/** The callout at the back arrow when something under the spotlight scrim is clicked. */
export const spotlightHint = (kind: string) => `Done with ${kind}? Go back to use the rest.`;

/** How the back arrow pulses (owner review: ?backPulse=ring|glow|nudge). */
export const BACK_PULSE_STYLES = ["ring", "glow", "nudge"] as const;
export type BackPulseStyle = typeof BACK_PULSE_STYLES[number];
export const BACK_PULSE_PARAM = "backPulse";

export function backPulseStyle(search: string): BackPulseStyle {
    const value = new URLSearchParams(search).get(BACK_PULSE_PARAM);
    return (BACK_PULSE_STYLES as readonly string[]).includes(value ?? "") ? value as BackPulseStyle : "ring";
}

export const SPOTLIGHT_NUDGE_EVENT = "keybard:binding-spotlight-nudge";

/** Ask the open editor to point at its way out: pulses the back arrow and shows the callout there. */
export function nudgeBindingEditor(at?: { x: number; y: number }) {
    window.dispatchEvent(new CustomEvent(SPOTLIGHT_NUDGE_EVENT, { detail: at ?? null }));
}
