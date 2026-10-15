import type { KeyOverrideEntry } from "@/types/keyboard.types";

/**
 * Key override option bits. Bits 0-5 match QMK's ko_option_t
 * (quantum/process_keycode/process_key_override.h); bit 7 is the Svalboard
 * enabled flag (modules/svalboard/core/sval.h). Bit 7 is the only owner of
 * on/off: nothing else in memory says whether an override is on.
 */
export const KeyOverrideOptions = {
    ACTIVATION_TRIGGER_DOWN: 1 << 0,
    ACTIVATION_REQUIRED_MOD_DOWN: 1 << 1,
    ACTIVATION_NEGATIVE_MOD_UP: 1 << 2,
    ONE_MOD: 1 << 3,
    NO_REREGISTER_TRIGGER: 1 << 4,
    NO_UNREGISTER_ON_OTHER_KEY_DOWN: 1 << 5,
    ENABLED: 1 << 7,
} as const;

/** QMK's ko_options_default: all three activation events. */
export const KO_DEFAULT_ACTIVATIONS =
    KeyOverrideOptions.ACTIVATION_TRIGGER_DOWN |
    KeyOverrideOptions.ACTIVATION_REQUIRED_MOD_DOWN |
    KeyOverrideOptions.ACTIVATION_NEGATIVE_MOD_UP;

/** Options a new override starts with: on, with QMK's default activations. */
export const KO_NEW_OPTIONS = KeyOverrideOptions.ENABLED | KO_DEFAULT_ACTIVATIONS;

export const isOverrideEnabled = (ko: Pick<KeyOverrideEntry, "options"> | undefined): boolean =>
    ((ko?.options ?? 0) & KeyOverrideOptions.ENABLED) !== 0;

const isEmptyKey = (kc: unknown) => !kc || kc === "KC_NO" || kc === 0;

/** An unused slot: no keys, no mods, no options. */
export const isBlankOverride = (ko: KeyOverrideEntry): boolean =>
    isEmptyKey(ko.trigger) && isEmptyKey(ko.replacement) &&
    !ko.trigger_mods && !ko.negative_mod_mask && !ko.suppressed_mods && !ko.options;

/** Layer mask covering every layer the board has (all 16 when unknown). */
export const allLayersMask = (layerCount: number | undefined): number => {
    const n = layerCount && layerCount > 0 ? Math.min(layerCount, 32) : 16;
    return n >= 32 ? 0xFFFFFFFF : ((1 << n) >>> 0) - 1;
};

/**
 * Called before the first edit of an override. A blank slot becomes a new
 * override: enabled, QMK default activations, on every layer the board has.
 * Mutates and returns the entry; non-blank entries are left as they are.
 */
export function prepareOverrideForEdit(ko: KeyOverrideEntry, layerCount: number | undefined): KeyOverrideEntry {
    if (isBlankOverride(ko)) {
        ko.options = KO_NEW_OPTIONS;
        ko.layers = allLayersMask(layerCount);
    }
    return ko;
}

/**
 * Sets the trigger mods. Suppressed mods follow the trigger mods for as long
 * as they still equal them, so Shift + Bksp -> Del sends a plain Del. Once the
 * user sets suppressed mods to anything else, they stop following.
 */
export function setOverrideTriggerMods(ko: KeyOverrideEntry, mods: number): KeyOverrideEntry {
    if (ko.suppressed_mods === ko.trigger_mods) ko.suppressed_mods = mods;
    ko.trigger_mods = mods;
    return ko;
}

/**
 * Folds a .svil entry's "on" flag into options bit 7.
 * - "on": false always wins and clears bit 7.
 * - "on": true defers to options when options is present: Keybard exports
 *   before bit 7 owned on/off wrote "on": true even for overrides turned off.
 * - With no options field, "on" alone decides, over QMK's default activations.
 */
export function overrideOptionsFromFile(on: unknown, options: unknown): number {
    const hasOptions = typeof options === "number";
    let opts = hasOptions ? (options as number) & 0xFF : KO_DEFAULT_ACTIVATIONS;
    if (on === false) opts &= ~KeyOverrideOptions.ENABLED;
    else if (!hasOptions) opts |= KeyOverrideOptions.ENABLED;
    return opts;
}
