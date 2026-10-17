export interface HardwareSettingHandler {
    get: () => Promise<number | boolean>;
    set: (value: number | boolean) => Promise<void>;
}

/**
 * Handlers for settings whose value lives on the board (`scope: "hardware"`).
 * It is empty: the pointing stubs that were here never reached the board and
 * were removed with their definitions (settings v2). Board configuration has
 * its home in the editor panels, not in Settings.
 */
export const HARDWARE_SETTINGS_REGISTRY: Record<string, HardwareSettingHandler> = {};
