/**
 * Combo indicator settings. One on/off switch owns whether folded corners show;
 * one boolean owns the palette (and the texture cue that comes with the colorblind palette).
 *
 * - off: no folds, no preview, no extra Tab stops.
 * - on (default): folds are compact at rest and grow while the pointer moves over
 *   the keyboard, then shrink back.
 *
 * The rendering code still speaks in modes: "small" is on.
 */
export type ComboIndicatorMode = "off" | "small";

export const COMBO_INDICATOR_SETTING = "combo-indicators";
/** The first boolean this setting replaced; a stored value is migrated on load. */
export const LEGACY_COMBO_INDICATOR_SETTING = "show-combo-indicators";
export const DEFAULT_COMBO_INDICATORS_ON = true;
export const DEFAULT_COMBO_INDICATOR_MODE: ComboIndicatorMode = "small";

export const COMBO_COLORBLIND_SETTING = "colorblind-combo-colors";

/**
 * Whether folds show, from a stored value. Booleans are the current form; the
 * select this switch replaced stored "off", "small" or "large" (both sizes are on).
 */
export const comboIndicatorsOn = (v: unknown): boolean => {
    if (typeof v === "boolean") return v;
    if (v === "off") return false;
    return DEFAULT_COMBO_INDICATORS_ON;
};

/** Mode from a stored value: "off" or "small" (on). */
export const comboIndicatorMode = (v: unknown): ComboIndicatorMode =>
    comboIndicatorsOn(v) ? "small" : "off";

/**
 * Bring stored combo indicator values to the switch: the old boolean
 * "show-combo-indicators" moves to "combo-indicators" (a stored current value
 * wins), and the old select values become booleans ("off" is off, "small" and
 * "large" are on). Returns the same object when there is nothing to migrate.
 */
export function migrateComboIndicatorSetting<T extends Record<string, unknown>>(settings: T): T {
    const hasLegacy = LEGACY_COMBO_INDICATOR_SETTING in settings;
    const current = settings[COMBO_INDICATOR_SETTING];
    const currentIsString = typeof current === "string";
    if (!hasLegacy && !currentIsString) return settings;
    const { [LEGACY_COMBO_INDICATOR_SETTING]: legacy, ...rest } = settings;
    const out: Record<string, unknown> = { ...rest };
    if (currentIsString) out[COMBO_INDICATOR_SETTING] = comboIndicatorsOn(current);
    else if (typeof current !== "boolean" && typeof legacy === "boolean") out[COMBO_INDICATOR_SETTING] = legacy;
    return out as T;
}

/** Idle delay before folds shrink back after the pointer stops moving. */
export const FOLD_IDLE_MS = 1200;
/** Review-only override for the idle delay (not saved). */
export const FOLD_IDLE_PARAM = "foldIdle";

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
