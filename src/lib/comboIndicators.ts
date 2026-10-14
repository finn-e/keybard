/**
 * Combo indicator settings. One select owns whether folded corners show and how big they are;
 * one boolean owns the palette (and the texture cue that comes with the colorblind palette).
 *
 * - "off": no folds, no preview, no extra Tab stops.
 * - "small" (default): compact at rest, grows while the pointer moves over the keyboard.
 * - "large": always the large size, no motion.
 */
export type ComboIndicatorMode = "off" | "small" | "large";

export const COMBO_INDICATOR_SETTING = "combo-indicators";
/** The boolean this select replaced; a stored value is migrated on load. */
export const LEGACY_COMBO_INDICATOR_SETTING = "show-combo-indicators";
export const DEFAULT_COMBO_INDICATOR_MODE: ComboIndicatorMode = "small";
export const COMBO_INDICATOR_MODES: readonly ComboIndicatorMode[] = ["off", "small", "large"];

export const COMBO_COLORBLIND_SETTING = "colorblind-combo-colors";

/** Idle delay before folds shrink back after the pointer stops moving. */
export const FOLD_IDLE_MS = 1200;
/** Review-only override for the idle delay (not saved). */
export const FOLD_IDLE_PARAM = "foldIdle";

export const isComboIndicatorMode = (v: unknown): v is ComboIndicatorMode =>
    typeof v === "string" && (COMBO_INDICATOR_MODES as readonly string[]).includes(v);

/** Mode from a stored value: a valid mode, else the default. */
export const comboIndicatorMode = (v: unknown): ComboIndicatorMode =>
    isComboIndicatorMode(v) ? v : DEFAULT_COMBO_INDICATOR_MODE;

/**
 * Move a stored boolean "show-combo-indicators" to the select: false becomes "off", true the
 * default. A stored select value wins. Returns the same object when there is nothing to migrate.
 */
export function migrateComboIndicatorSetting<T extends Record<string, unknown>>(settings: T): T {
    if (!(LEGACY_COMBO_INDICATOR_SETTING in settings)) return settings;
    const { [LEGACY_COMBO_INDICATOR_SETTING]: legacy, ...rest } = settings;
    const out: Record<string, unknown> = { ...rest };
    if (!isComboIndicatorMode(out[COMBO_INDICATOR_SETTING]) && typeof legacy === "boolean") {
        out[COMBO_INDICATOR_SETTING] = legacy ? DEFAULT_COMBO_INDICATOR_MODE : "off";
    }
    return out as T;
}

/** Idle delay: a valid `?foldIdle=<ms>` (0 to 60000) for this page load, else the default. */
export function foldIdleMs(search: string): number {
    try {
        const raw = new URLSearchParams(search).get(FOLD_IDLE_PARAM);
        if (raw != null && raw.trim() !== "") {
            const n = Number(raw);
            if (Number.isFinite(n) && n >= 0 && n <= 60000) return n;
        }
    } catch { /* fall through */ }
    return FOLD_IDLE_MS;
}
