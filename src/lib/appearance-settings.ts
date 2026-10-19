/**
 * Stored preferences for how the editor is laid out. They default to Auto,
 * which follows the window. Their one home is Settings > Appearance.
 */
export const KEY_SIZE_SETTING = "key-size";
export const PANEL_POSITION_SETTING = "panel-position";

export type KeySizePreference = "auto" | "default" | "medium" | "small";
export type PanelPositionPreference = "auto" | "sidebar" | "bottombar";

export const DEFAULT_KEY_SIZE: KeySizePreference = "auto";
export const DEFAULT_PANEL_POSITION: PanelPositionPreference = "auto";

export const isKeySizePreference = (value: unknown): value is KeySizePreference =>
    value === "auto" || value === "default" || value === "medium" || value === "small";

export const isPanelPositionPreference = (value: unknown): value is PanelPositionPreference =>
    value === "auto" || value === "sidebar" || value === "bottombar";
