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

/**
 * The open editor's kind and number ("Combo 0", "Tap Dance 2"). The one
 * owner of how the picker header and the back-arrow callout name the editor,
 * so the two always agree. Numbers only, never a custom name.
 */
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

/** The picker panel's header while a binding editor is open ("Editing Tap Dance 3"). */
export const bindingEditorHeading = (editor: string | null | undefined, index: number | null): string =>
    `Editing ${bindingEditorKind(editor, index)}`;

/**
 * The open item's custom name, shown under the picker header; null when it
 * has none. Tap dances and macros are the kinds that store a name.
 */
export function bindingEditorSubtitle(
    editor: string | null | undefined,
    index: number | null,
    cosmetic?: { macros?: Record<string, string>; tapdances?: Record<string, string> },
): string | null {
    if (index === null || !editor) return null;
    const names = editor === "macros" ? cosmetic?.macros : editor === "tapdances" ? cosmetic?.tapdances : undefined;
    const name = names?.[String(index)]?.trim();
    return name ? name : null;
}

/** The callout at the back arrow when something under the spotlight scrim is clicked. */
export const spotlightHint = (kind: string) => `Done with ${kind}? Go back to use the rest.`;

/**
 * How strongly the scrim dims (owner review: ?spot=soft|deep). The default
 * matches the prototype; the others only change --kb-scrim-alpha.
 */
export const SPOT_STRENGTHS = ["medium", "soft", "deep"] as const;
export type SpotStrength = typeof SPOT_STRENGTHS[number];
export const SPOT_PARAM = "spot";

export function spotStrength(search: string): SpotStrength {
    const value = new URLSearchParams(search).get(SPOT_PARAM);
    return (SPOT_STRENGTHS as readonly string[]).includes(value ?? "") ? value as SpotStrength : "medium";
}

/**
 * What the rail does while an editor is open (owner review: ?railMode=collapse).
 * "lift" (the default) keeps the rail's picker categories usable above its
 * scrim. "collapse" puts the whole rail under the scrim and narrows it to its
 * icons, giving that width to the layout; the side panel's own category strip
 * is then the one picker selector. "modal" turns the whole rail into the
 * editor's own: its navigation gives way to the editor's picker categories,
 * the side panel's category strip goes, and the rail's top-left corner is the
 * way out. Read from the URL only, never saved.
 */
export const RAIL_MODES = ["lift", "collapse", "modal"] as const;
export type RailMode = typeof RAIL_MODES[number];
export const RAIL_MODE_PARAM = "railMode";

export function railModeFrom(search: string): RailMode {
    let value: string | null = null;
    try { value = new URLSearchParams(search).get(RAIL_MODE_PARAM); } catch { value = null; }
    return (RAIL_MODES as readonly string[]).includes(value ?? "") ? value as RailMode : "lift";
}

/** This page load's rail mode. */
export const currentRailMode = (): RailMode =>
    typeof window === "undefined" ? "lift" : railModeFrom(window.location.search);

/** ?railMode=modal: the rail's top-left exit while an editor is open ("Done with Combo 3"). */
export const modalRailExitLabel = (kind: string) => `Done with ${kind}`;

/** ?railMode=modal: how long the rail's contents take to swap in place (none with reduced motion). */
export const RAIL_MODAL_SWAP_MS = 200;

/** How long the rail takes to narrow and to come back (none with reduced motion). */
export const RAIL_COLLAPSE_MS = 250;
export const RAIL_COLLAPSE_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

/** The second cue on a rail click in collapse mode, at the side panel's category strip. */
export const PICKER_STRIP_HINT = "Pick keys here";
/** The same cue for screen readers, which cannot see where "here" is. */
export const PICKER_STRIP_HINT_SR = "Or pick keys from the categories in the side panel.";

export const SPOTLIGHT_NUDGE_EVENT = "keybard:binding-spotlight-nudge";

/** Where a blocked click came from: "rail" also points at the side panel's category strip in collapse mode. */
export type NudgeSource = "rail";
export type NudgeDetail = { x?: number; y?: number; from?: NudgeSource } | null;

/** Ask the open editor to point at its way out: pulses the back arrow and shows the callout there. */
export function nudgeBindingEditor(at?: { x: number; y: number }, from?: NudgeSource) {
    const detail: NudgeDetail = at || from ? { ...(at ?? {}), ...(from ? { from } : {}) } : null;
    window.dispatchEvent(new CustomEvent(SPOTLIGHT_NUDGE_EVENT, { detail }));
}

/**
 * How the rail lights its usable categories while editing (owner review:
 * ?spotLight=text|tint|pill). Unset, each theme takes its own default: light
 * shows ink labels on the scrim with a pill only on the current category and
 * the origin ("text"); dark keeps a pill on every lit item ("pill").
 */
export const SPOT_LIGHTS = ["text", "tint", "pill"] as const;
export type SpotLight = typeof SPOT_LIGHTS[number];
export const SPOT_LIGHT_PARAM = "spotLight";

/**
 * Where the rail meets the picker panel while editing (owner review:
 * ?railJoin=tuck|gutter). "tuck" (default) squares the rail's right corners
 * under the panel; "gutter" moves the panel 8px clear of the rounded rail.
 */
export const RAIL_JOINS = ["tuck", "gutter"] as const;
export type RailJoin = typeof RAIL_JOINS[number];
export const RAIL_JOIN_PARAM = "railJoin";

/**
 * The rail's active bar, editing or not (owner review: ?railBar=flush|gap2|kiss).
 * "flush" (default) sits on the rail's inner edge, 20px tall, 3px clear of the
 * pill; "gap2" sits 3px in with a 2px gap; "kiss" is the earlier 26px bar 1px
 * from the pill.
 */
export const RAIL_BARS = ["flush", "gap2", "kiss"] as const;
export type RailBar = typeof RAIL_BARS[number];
export const RAIL_BAR_PARAM = "railBar";

/** A review param's value when it is one of the choices, otherwise null (the default). */
export function reviewChoice<T extends string>(search: string, param: string, choices: readonly T[]): T | null {
    const value = new URLSearchParams(search).get(param);
    return (choices as readonly string[]).includes(value ?? "") ? value as T : null;
}
