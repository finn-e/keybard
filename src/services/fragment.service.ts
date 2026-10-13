/**
 * Fragment service for managing hardware detection and EEPROM selections
 *
 * Handles protocol commands:
 * - 0x18: Fragment Get Hardware (query hardware-detected fragments)
 * - 0x19: Fragment Get Selections (query EEPROM selections)
 * - 0x1A: Fragment Set Selections (save selections to EEPROM)
 */

import type { KeyboardInfo } from "../types/keyboard.types";
import { SvilUSB } from "./usb.service";
import { isWidgetInstance } from "./fragment-composer.service";

// Max number of fragment instances (protocol uses fixed 21-byte arrays)
const MAX_INSTANCES = 21;
// Value indicating no detection/selection
export const NO_SELECTION = 0xff;

/**
 * Safely get a value from something that might be a Map or a plain object
 * (handles JSON deserialization where Maps become objects)
 */
function safeMapGet<K extends string | number, V>(
    mapOrObj: Map<K, V> | Record<string, V> | undefined,
    key: K
): V | undefined {
    if (!mapOrObj) return undefined;
    if (mapOrObj instanceof Map) {
        return mapOrObj.get(key);
    }
    // Plain object - convert key to string for lookup
    return (mapOrObj as Record<string, V>)[String(key)];
}

export class FragmentService {
    constructor(private usb: SvilUSB) { }

    /**
     * Load fragment data from device (hardware detection and EEPROM selections)
     */
    async get(kbinfo: KeyboardInfo): Promise<void> {
        // Initialize fragment state if not present
        if (!kbinfo.fragmentState) {
            kbinfo.fragmentState = {
                hwDetection: new Map(),
                eepromSelections: new Map(),
                userSelections: new Map(),
            };
        }

        // Only query if keyboard has fragments defined
        if (!this.hasFragments(kbinfo)) {
            return;
        }

        await this.getHardwareDetection(kbinfo);
        await this.getEepromSelections(kbinfo);
    }

    /**
     * Query hardware detection results via 0x18 and store them in fragmentState.
     */
    private async getHardwareDetection(kbinfo: KeyboardInfo): Promise<void> {
        const detected = await this.readHardwareDetection();
        if (!detected) return;
        const state = kbinfo.fragmentState!;
        state.hwDetection.clear();
        for (const [idx, id] of detected) state.hwDetection.set(idx, id);
    }

    /**
     * Reads 0x18 (hardware detection) without touching any keyboard state.
     * Response: [cmd_echo][count][frag0..frag20]. Instances reporting 0xFF (not
     * detected, or not settled yet) are left out. Null when the read fails.
     */
    async readHardwareDetection(): Promise<Map<number, number> | null> {
        try {
            const data = await this.usb.sendSvil(
                SvilUSB.CMD_SVIL_FRAGMENT_GET_HARDWARE,
                [],
                { uint8: true }
            ) as Uint8Array;

            // Response: [0x18][count][21 bytes data]
            if (data.length < 3) {
                console.warn("Fragment hardware detection response too short");
                return null;
            }

            const count = data[1];
            const detected = new Map<number, number>();
            // Parse fragment IDs for each instance position
            for (let i = 0; i < count && i < MAX_INSTANCES && 2 + i < data.length; i++) {
                const fragmentId = data[2 + i];
                // 0xFF means no detection, don't store
                if (fragmentId !== NO_SELECTION) {
                    detected.set(i, fragmentId);
                }
            }
            return detected;
        } catch (e) {
            console.warn("Failed to get fragment hardware detection:", e);
            return null;
        }
    }

    /**
     * Query EEPROM selections via 0x19
     * Response: [cmd_echo][count][opt0..opt20]
     */
    private async getEepromSelections(kbinfo: KeyboardInfo): Promise<void> {
        try {
            const data = await this.usb.sendSvil(
                SvilUSB.CMD_SVIL_FRAGMENT_GET_SELECTIONS,
                [],
                { uint8: true }
            ) as Uint8Array;

            // Response: [0x19][count][21 bytes data]
            if (data.length < 3) {
                console.warn("Fragment EEPROM selections response too short");
                return;
            }

            const count = data[1];
            const state = kbinfo.fragmentState!;
            state.eepromSelections.clear();
            state.selectionsRead = true;
            const instances = kbinfo.composition?.instances ?? [];

            // Parse option indices for each instance position
            // Note: EEPROM stores option indices, NOT fragment IDs
            for (let i = 0; i < count && i < MAX_INSTANCES; i++) {
                // Widget instances (pointing slots) follow detection only: ignore their bytes.
                if (instances[i] && isWidgetInstance(kbinfo, instances[i])) continue;
                const optionIdx = data[2 + i];
                // 0xFF means no selection, don't store
                if (optionIdx !== NO_SELECTION) {
                    state.eepromSelections.set(i, optionIdx);
                }
            }
        } catch (e) {
            console.warn("Failed to get fragment EEPROM selections:", e);
        }
    }

    /**
     * Save fragment selection to EEPROM via 0x1A
     *
     * @param kbinfo Keyboard info
     * @param instanceIdx Instance array position (0-20)
     * @param optionIdx Option index into fragment_options (0-254), or 0xFF to clear
     * @returns true on success, false on failure
     */
    async setSelection(kbinfo: KeyboardInfo, instanceIdx: number, optionIdx: number): Promise<boolean> {
        // 0x1A replaces every instance's selection: without the board's current ones
        // (0x19 failed at connect), writing one would reset the others.
        if (!kbinfo.fragmentState?.selectionsRead) {
            return false;
        }

        const instanceCount = this.getInstanceCount(kbinfo);
        if (instanceCount === 0) {
            return false;
        }

        // Build fixed 21-byte array: used slots from cache, unused slots 0xFF
        const selections = new Array<number>(MAX_INSTANCES).fill(NO_SELECTION);

        for (let i = 0; i < instanceCount; i++) {
            if (i === instanceIdx) {
                selections[i] = optionIdx;
            } else {
                // Use current EEPROM selection or 0xFF (safe access handles Map or object)
                selections[i] = safeMapGet(kbinfo.fragmentState.eepromSelections, i) ?? NO_SELECTION;
            }
        }

        try {
            const data = await this.usb.sendSvil(
                SvilUSB.CMD_SVIL_FRAGMENT_SET_SELECTIONS,
                [instanceCount, ...selections],
                { uint8: true }
            ) as Uint8Array;

            // Response: [0x1A][status] where 0x00 = success
            if (data.length >= 2 && data[1] === 0x00) {
                // Update local cache
                if (optionIdx === NO_SELECTION) {
                    kbinfo.fragmentState.eepromSelections.delete(instanceIdx);
                } else {
                    kbinfo.fragmentState.eepromSelections.set(instanceIdx, optionIdx);
                }
                return true;
            }
            return false;
        } catch (e) {
            console.error("Failed to set fragment selection:", e);
            return false;
        }
    }

    /**
     * Check if keyboard definition has fragments
     */
    hasFragments(kbinfo: KeyboardInfo): boolean {
        return Boolean(kbinfo.fragments) &&
               Boolean(kbinfo.composition?.instances?.length);
    }

    /**
     * Get number of instances in composition
     */
    getInstanceCount(kbinfo: KeyboardInfo): number {
        return kbinfo.composition?.instances?.length ?? 0;
    }

    /**
     * Get list of selectable instances (those with fragment_options). Widget
     * instances (pointing slots) are not selectable: hardware detection decides them.
     */
    getSelectableInstances(kbinfo: KeyboardInfo): Array<{ idx: number; instance: NonNullable<KeyboardInfo['composition']>['instances'][0] }> {
        if (!kbinfo.composition?.instances) {
            return [];
        }

        return kbinfo.composition.instances
            .map((instance, idx) => ({ idx, instance }))
            .filter(({ instance }) => instance.fragment_options && instance.fragment_options.length > 0 && !isWidgetInstance(kbinfo, instance));
    }

    /**
     * Get fragment name from numeric fragment ID (from hardware detection)
     */
    getFragmentNameById(kbinfo: KeyboardInfo, fragmentId: number): string | undefined {
        if (!kbinfo.fragments) return undefined;

        for (const [name, frag] of Object.entries(kbinfo.fragments)) {
            if (frag.id === fragmentId) {
                return name;
            }
        }
        return undefined;
    }

    /**
     * Get fragment ID from fragment name
     */
    getFragmentId(kbinfo: KeyboardInfo, fragmentName: string): number {
        return kbinfo.fragments?.[fragmentName]?.id ?? NO_SELECTION;
    }

    /**
     * Get display name for a fragment
     */
    getFragmentDisplayName(kbinfo: KeyboardInfo, fragmentName: string): string {
        const fragment = kbinfo.fragments?.[fragmentName];
        if (fragment?.description) {
            return fragment.description;
        }
        // Fallback: convert snake_case to Title Case
        return fragmentName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }

    /**
     * Get display name for an instance position
     */
    getInstanceDisplayName(instanceId: string): string {
        // Convert snake_case to Title Case
        return instanceId.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }

    /**
     * Get available fragment options for an instance
     */
    getFragmentOptions(instance: NonNullable<KeyboardInfo['composition']>['instances'][0]): string[] {
        if (instance.fragment) {
            return []; // Fixed instance, no options
        }
        return instance.fragment_options?.map(opt => opt.fragment) ?? [];
    }

    /**
     * Get option index for a fragment within an instance's fragment_options
     */
    getOptionIndex(instance: NonNullable<KeyboardInfo['composition']>['instances'][0], fragmentName: string): number {
        const options = instance.fragment_options ?? [];
        const idx = options.findIndex(opt => opt.fragment === fragmentName);
        return idx >= 0 ? idx : 0;
    }

    /**
     * Resolve which fragment to use for an instance
     *
     * Priority:
     * 1. If hardware detected AND allow_override=false: hardware wins
     * 2. User selection (from keymap file or UI)
     * 3. EEPROM selection
     * 4. Hardware detection (if allow_override=true)
     * 5. Default (first option in fragment_options)
     */
    resolveFragment(
        kbinfo: KeyboardInfo,
        instanceIdx: number,
        instance: NonNullable<KeyboardInfo['composition']>['instances'][0]
    ): string {
        const state = kbinfo.fragmentState;

        // Fixed instance - no options
        if (instance.fragment) {
            return instance.fragment;
        }

        const options = instance.fragment_options;
        if (!options || options.length === 0) {
            return '';
        }

        const allowOverride = instance.allow_override !== false;
        // Safe access handles both Map and plain object from JSON deserialization
        const hwFragmentId = safeMapGet(state?.hwDetection, instanceIdx);
        const hwDetected = hwFragmentId !== undefined && hwFragmentId !== NO_SELECTION;

        // 1. Hardware detected AND override not allowed
        if (hwDetected && !allowOverride) {
            const hwFragmentName = this.getFragmentNameById(kbinfo, hwFragmentId);
            if (hwFragmentName) {
                const matchingOption = options.find(opt => opt.fragment === hwFragmentName);
                if (matchingOption) {
                    return matchingOption.fragment;
                }
            }
        }

        // 2. User selection (from keymap file or UI)
        const userSelection = safeMapGet(state?.userSelections, instance.id);
        if (userSelection) {
            const matchingOption = options.find(opt => opt.fragment === userSelection);
            if (matchingOption) {
                return matchingOption.fragment;
            }
        }

        // 3. EEPROM selection
        const eepromOptionIdx = safeMapGet(state?.eepromSelections, instanceIdx);
        if (eepromOptionIdx !== undefined && eepromOptionIdx < options.length) {
            return options[eepromOptionIdx].fragment;
        }

        // 4. Hardware detection (with override allowed)
        if (hwDetected) {
            const hwFragmentName = this.getFragmentNameById(kbinfo, hwFragmentId);
            if (hwFragmentName) {
                const matchingOption = options.find(opt => opt.fragment === hwFragmentName);
                if (matchingOption) {
                    return matchingOption.fragment;
                }
            }
        }

        // 5. Default (first option or one marked as default)
        const defaultOption = options.find(opt => opt.default) ?? options[0];
        return defaultOption.fragment;
    }
}
