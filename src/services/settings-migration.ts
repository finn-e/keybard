import type { SettingsState } from "@/types/settings.types";

/**
 * The stored `keyboard-settings` object carries a schema version in `__v`.
 * Objects saved before versioning are version 1.
 *
 * v2 (Settings as one page): drops the pointing hardware settings that were
 * never wired to the board. Every other key is kept as it is, including keys
 * this build doesn't know, so preferences added on other branches survive.
 */
export const SETTINGS_SCHEMA_VERSION = 2;
export const SETTINGS_VERSION_KEY = "__v";

/** Pointing hardware settings from v1 that nothing reads or writes. */
export const DEAD_V1_SETTINGS = [
    "left-dpi",
    "right-dpi",
    "scroll-left",
    "scroll-right",
    "auto-mouse",
    "auto-mouse-timeout",
] as const;

const isStoredValue = (value: unknown): value is string | number | boolean =>
    typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));

/**
 * Bring a stored settings object up to the current schema. It is idempotent:
 * migrating a current object returns the same keys and values. Anything that
 * isn't a plain object gives the defaults (an empty current object).
 */
export function migrateSettings(stored: unknown): SettingsState {
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
        return { [SETTINGS_VERSION_KEY]: SETTINGS_SCHEMA_VERSION };
    }
    const settings: SettingsState = {};
    for (const [key, value] of Object.entries(stored as Record<string, unknown>)) {
        if (isStoredValue(value)) settings[key] = value;
    }
    const raw = settings[SETTINGS_VERSION_KEY];
    const version = typeof raw === "number" && Number.isInteger(raw) && raw >= 1 ? raw : 1;
    if (version < 2) {
        for (const key of DEAD_V1_SETTINGS) delete settings[key];
    }
    // A newer build's object is left at its own version.
    settings[SETTINGS_VERSION_KEY] = Math.max(version, SETTINGS_SCHEMA_VERSION);
    return settings;
}
