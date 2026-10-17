/**
 * Alt-Repeat is behind an app preference, off by default. When it is off the
 * rail has no Alt-Repeat item and nothing opens its panel or editor. This only
 * hides the editor: alt-repeat entries on the board, in backups and in
 * import/export are kept and written exactly as before.
 */
export const SHOW_ALT_REPEAT_SETTING = "show-alt-repeat";
export const DEFAULT_SHOW_ALT_REPEAT = false;
export const ALT_REPEAT_PANEL = "altrepeat";

/** True when a panel can be shown under the current Alt-Repeat preference. */
export const panelAllowed = (panel: string | null | undefined, showAltRepeat: boolean): boolean =>
    showAltRepeat || panel !== ALT_REPEAT_PANEL;
