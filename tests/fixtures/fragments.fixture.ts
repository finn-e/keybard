/**
 * Fragment Test Fixtures
 *
 * Test data for fragment definitions, compositions, states, and USB responses.
 * Used for testing fragment resolution, layout composition, and save/load cycles.
 */

import type {
    KeyboardInfo,
    FragmentDefinition,
    FragmentOption,
    FragmentInstance,
    FragmentComposition,
    FragmentState,
    FragmentWidget
} from '../../src/types/keyboard.types';
import { createTestKeyboardInfo } from './keyboard-info.fixture';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

// Fragment IDs (protocol uses numeric IDs)
export const FRAGMENT_IDS = {
    FINGER_5KEY: 1,
    FINGER_6KEY: 2,
    THUMB_4KEY: 3,
    THUMB_5KEY: 4,
    NUMPAD: 5,
};

// Fragment name constants
export const FRAGMENT_NAMES = {
    FINGER_5KEY: 'finger_5key',
    FINGER_6KEY: 'finger_6key',
    THUMB_4KEY: 'thumb_4key',
    THUMB_5KEY: 'thumb_5key',
    NUMPAD: 'numpad',
};

/**
 * Simple KLE data for test fragments
 * Each fragment has different key counts for testing
 */
export const TEST_KLE_DATA = {
    // 5-key finger cluster (simplified)
    finger_5key: [
        [{ w: 1 }, "K1"],
        [{ w: 1 }, "K2"],
        [{ w: 1 }, "K3"],
        [{ w: 1 }, "K4"],
        [{ w: 1 }, "K5"]
    ],
    // 6-key finger cluster
    finger_6key: [
        [{ w: 1 }, "K1"],
        [{ w: 1 }, "K2"],
        [{ w: 1 }, "K3"],
        [{ w: 1 }, "K4"],
        [{ w: 1 }, "K5"],
        [{ w: 1 }, "K6"]
    ],
    // 4-key thumb cluster
    thumb_4key: [
        [{ w: 1.5 }, "T1"],
        [{ w: 1 }, "T2"],
        [{ w: 1 }, "T3"],
        [{ w: 1.5 }, "T4"]
    ],
    // 5-key thumb cluster
    thumb_5key: [
        [{ w: 1.25 }, "T1"],
        [{ w: 1 }, "T2"],
        [{ w: 1 }, "T3"],
        [{ w: 1 }, "T4"],
        [{ w: 1.25 }, "T5"]
    ],
};

/**
 * Create fragment definitions for testing
 */
export function createTestFragments(): Record<string, FragmentDefinition> {
    return {
        [FRAGMENT_NAMES.FINGER_5KEY]: {
            id: FRAGMENT_IDS.FINGER_5KEY,
            description: '5-key finger cluster',
            kle: TEST_KLE_DATA.finger_5key,
        },
        [FRAGMENT_NAMES.FINGER_6KEY]: {
            id: FRAGMENT_IDS.FINGER_6KEY,
            description: '6-key finger cluster',
            kle: TEST_KLE_DATA.finger_6key,
        },
        [FRAGMENT_NAMES.THUMB_4KEY]: {
            id: FRAGMENT_IDS.THUMB_4KEY,
            description: '4-key thumb cluster',
            kle: TEST_KLE_DATA.thumb_4key,
        },
        [FRAGMENT_NAMES.THUMB_5KEY]: {
            id: FRAGMENT_IDS.THUMB_5KEY,
            description: '5-key thumb cluster',
            kle: TEST_KLE_DATA.thumb_5key,
        },
    };
}

/**
 * Create a fixed fragment instance (no user selection)
 */
export function createFixedInstance(overrides?: Partial<FragmentInstance>): FragmentInstance {
    return {
        id: 'center_keys',
        fragment: FRAGMENT_NAMES.NUMPAD,
        placement: { x: 5, y: 0 },
        matrix_map: [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2]],
        ...overrides,
    };
}

/**
 * Create a selectable fragment instance with multiple options
 */
export function createSelectableInstance(overrides?: Partial<FragmentInstance>): FragmentInstance {
    return {
        id: 'left_finger',
        fragment_options: [
            {
                fragment: FRAGMENT_NAMES.FINGER_5KEY,
                placement: { x: 0, y: 0 },
                matrix_map: [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1]],
                default: true,
            },
            {
                fragment: FRAGMENT_NAMES.FINGER_6KEY,
                placement: { x: 0, y: 0 },
                matrix_map: [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2]],
            },
        ],
        allow_override: true,
        ...overrides,
    };
}

/**
 * Create selectable instance with allow_override=false (hardware locked)
 */
export function createLockedInstance(overrides?: Partial<FragmentInstance>): FragmentInstance {
    return {
        id: 'right_finger',
        fragment_options: [
            {
                fragment: FRAGMENT_NAMES.FINGER_5KEY,
                placement: { x: 10, y: 0 },
                matrix_map: [[0, 7], [0, 8], [0, 9], [1, 7], [1, 8]],
            },
            {
                fragment: FRAGMENT_NAMES.FINGER_6KEY,
                placement: { x: 10, y: 0 },
                matrix_map: [[0, 7], [0, 8], [0, 9], [1, 7], [1, 8], [1, 9]],
            },
        ],
        allow_override: false,
        ...overrides,
    };
}

/**
 * Create a full test composition with fixed and selectable instances
 */
export function createTestComposition(): FragmentComposition {
    return {
        instances: [
            createSelectableInstance({ id: 'left_finger' }),
            createSelectableInstance({ id: 'right_finger' }),
            createFixedInstance({ id: 'center_keys' }),
        ],
    };
}

/**
 * Create fragment state with specific selections
 */
export function createFragmentState(overrides?: Partial<{
    hwDetection: Map<number, number> | [number, number][];
    eepromSelections: Map<number, number> | [number, number][];
    userSelections: Map<string, string> | [string, string][];
}>): FragmentState {
    const toMap = <K, V>(value: Map<K, V> | [K, V][] | undefined): Map<K, V> => {
        if (!value) return new Map();
        if (value instanceof Map) return value;
        return new Map(value);
    };

    return {
        hwDetection: toMap(overrides?.hwDetection),
        eepromSelections: toMap(overrides?.eepromSelections),
        userSelections: toMap(overrides?.userSelections),
    };
}

/**
 * Create a complete KeyboardInfo with fragments configured
 */
export function createKbinfoWithFragments(options?: {
    rows?: number;
    cols?: number;
    layers?: number;
    fragmentState?: Partial<FragmentState>;
    includeKeymap?: boolean;
    use6Key?: boolean;
}): KeyboardInfo {
    const {
        rows = 5,
        cols = 14,
        layers = 4,
        fragmentState,
        includeKeymap = true,
        use6Key = false,
    } = options ?? {};

    const kbinfo = createTestKeyboardInfo({
        rows,
        cols,
        layers,
        kbid: 'fragment_test_kb',
    });

    // Add fragments
    kbinfo.fragments = createTestFragments();

    // Add composition
    kbinfo.composition = {
        instances: [
            createSelectableInstance({ id: 'left_finger' }),
            createLockedInstance({ id: 'right_finger' }),
        ],
    };

    // Add fragment state
    if (fragmentState) {
        kbinfo.fragmentState = createFragmentState({
            hwDetection: fragmentState.hwDetection as any,
            eepromSelections: fragmentState.eepromSelections as any,
            userSelections: fragmentState.userSelections as any,
        });
    } else {
        // Default state - simulates 5-key hardware detected
        kbinfo.fragmentState = createFragmentState({
            hwDetection: use6Key
                ? [[0, FRAGMENT_IDS.FINGER_6KEY], [1, FRAGMENT_IDS.FINGER_6KEY]]
                : [[0, FRAGMENT_IDS.FINGER_5KEY], [1, FRAGMENT_IDS.FINGER_5KEY]],
        });
    }

    // Generate keymap if requested
    if (includeKeymap && kbinfo.layers && kbinfo.rows && kbinfo.cols) {
        kbinfo.keymap = generateTestKeymap(kbinfo.layers, kbinfo.rows, kbinfo.cols);
    }

    return kbinfo;
}

/**
 * Generate a test keymap with varied keycodes
 */
export function generateTestKeymap(layers: number, rows: number, cols: number): number[][] {
    const keymap: number[][] = [];

    for (let layer = 0; layer < layers; layer++) {
        const layerKeys: number[] = [];
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const pos = row * cols + col;
                // Generate varied keycodes based on layer and position
                if (layer === 0) {
                    // Layer 0: Basic letters/keys
                    layerKeys.push(0x04 + (pos % 26)); // KC_A through KC_Z
                } else if (layer === 1) {
                    // Layer 1: Numbers and mods
                    layerKeys.push(0x1E + (pos % 10)); // KC_1 through KC_0
                } else if (layer === 2) {
                    // Layer 2: Function keys
                    layerKeys.push(0x3A + (pos % 12)); // KC_F1 through KC_F12
                } else {
                    // Other layers: transparent or no
                    layerKeys.push(pos % 2 === 0 ? 0x0001 : 0x0000); // KC_TRNS or KC_NO
                }
            }
        }
        keymap.push(layerKeys);
    }

    return keymap;
}

/**
 * Create special keycodes keymap for integrity testing
 */
export function generateComplexKeymap(rows: number, cols: number, layers: number): number[][] {
    const keymap: number[][] = [];
    const totalKeys = rows * cols;

    for (let layer = 0; layer < layers; layer++) {
        const layerKeys: number[] = [];
        for (let pos = 0; pos < totalKeys; pos++) {
            // Generate a variety of keycode types
            const type = (layer * totalKeys + pos) % 10;
            switch (type) {
                case 0:
                    layerKeys.push(0x0000); // KC_NO
                    break;
                case 1:
                    layerKeys.push(0x0001); // KC_TRNS
                    break;
                case 2:
                    layerKeys.push(0x04 + (pos % 26)); // Basic letters KC_A-KC_Z
                    break;
                case 3:
                    layerKeys.push(0x5700 + (pos % 128)); // Macro M0-M127
                    break;
                case 4:
                    layerKeys.push(0x5740 + (pos % 32)); // Tap dance TD0-TD31
                    break;
                case 5:
                    layerKeys.push(0x5100 + (pos % 16)); // MO(layer)
                    break;
                case 6:
                    layerKeys.push(0x5200 + (pos % 16)); // TO(layer)
                    break;
                case 7:
                    layerKeys.push(0x0104 + (pos % 26)); // LCTL(KC_A-KC_Z)
                    break;
                case 8:
                    layerKeys.push(0x7E40 + (pos % 32)); // USER00-USER31
                    break;
                default:
                    layerKeys.push(0x3A + (pos % 12)); // Function keys F1-F12
                    break;
            }
        }
        keymap.push(layerKeys);
    }

    return keymap;
}

/**
 * USB mock response generators
 */
export const USB_RESPONSES = {
    /**
     * Create hardware detection response (CMD 0x18)
     * Response format: [0x18][count][frag0..frag20]
     */
    hardwareDetection: (detections: Record<number, number>): Uint8Array => {
        const count = Math.max(...Object.keys(detections).map(Number), 0) + 1;
        const response = new Uint8Array(23);
        response[0] = 0x18; // Command echo
        response[1] = count;

        // Fill with 0xFF (no detection)
        response.fill(0xFF, 2);

        // Set detected fragments
        for (const [idx, fragId] of Object.entries(detections)) {
            response[2 + Number(idx)] = fragId;
        }

        return response;
    },

    /**
     * Create EEPROM selections response (CMD 0x19)
     * Response format: [0x19][count][opt0..opt20]
     */
    eepromSelections: (selections: Record<number, number>): Uint8Array => {
        const count = Math.max(...Object.keys(selections).map(Number), 0) + 1;
        const response = new Uint8Array(23);
        response[0] = 0x19; // Command echo
        response[1] = count;

        // Fill with 0xFF (no selection)
        response.fill(0xFF, 2);

        // Set selections
        for (const [idx, optIdx] of Object.entries(selections)) {
            response[2 + Number(idx)] = optIdx;
        }

        return response;
    },

    /**
     * Create set selection response (CMD 0x1A)
     * Response format: [0x1A][status] where 0x00 = success
     */
    setSelectionSuccess: (): Uint8Array => {
        return new Uint8Array([0x1A, 0x00]);
    },

    setSelectionFailure: (): Uint8Array => {
        return new Uint8Array([0x1A, 0x01]);
    },
};

/**
 * Test scenarios for fragment resolution
 */
export const RESOLUTION_SCENARIOS = {
    /**
     * Fixed instance - should always return fixed fragment
     */
    fixedInstance: {
        instance: createFixedInstance(),
        instanceIdx: 0,
        state: createFragmentState(),
        expected: FRAGMENT_NAMES.NUMPAD,
    },

    /**
     * Hardware detected + allow_override=false → hardware wins
     */
    hardwareLocked: {
        instance: createLockedInstance(),
        instanceIdx: 0,
        state: createFragmentState({
            hwDetection: [[0, FRAGMENT_IDS.FINGER_6KEY]],
            userSelections: [['right_finger', FRAGMENT_NAMES.FINGER_5KEY]],
        }),
        expected: FRAGMENT_NAMES.FINGER_6KEY,
    },

    /**
     * User selection overrides hardware when allow_override=true
     */
    userOverridesHardware: {
        instance: createSelectableInstance(),
        instanceIdx: 0,
        state: createFragmentState({
            hwDetection: [[0, FRAGMENT_IDS.FINGER_5KEY]],
            userSelections: [['left_finger', FRAGMENT_NAMES.FINGER_6KEY]],
        }),
        expected: FRAGMENT_NAMES.FINGER_6KEY,
    },

    /**
     * EEPROM selection used when no user selection
     */
    eepromSelection: {
        instance: createSelectableInstance(),
        instanceIdx: 0,
        state: createFragmentState({
            hwDetection: [[0, FRAGMENT_IDS.FINGER_5KEY]],
            eepromSelections: [[0, 1]], // Option index 1 = 6-key
        }),
        expected: FRAGMENT_NAMES.FINGER_6KEY,
    },

    /**
     * Default option when no selections
     */
    defaultOption: {
        instance: createSelectableInstance(),
        instanceIdx: 0,
        state: createFragmentState(),
        expected: FRAGMENT_NAMES.FINGER_5KEY, // First option is marked default
    },

    /**
     * Invalid user selection falls back to hardware/EEPROM/default
     */
    invalidUserSelection: {
        instance: createSelectableInstance(),
        instanceIdx: 0,
        state: createFragmentState({
            hwDetection: [[0, FRAGMENT_IDS.FINGER_5KEY]],
            userSelections: [['left_finger', 'nonexistent_fragment']],
        }),
        expected: FRAGMENT_NAMES.FINGER_5KEY, // Falls back to hardware detection
    },
};

/**
 * Export test data for .svil file format testing
 */
export const SVIL_FILE_FRAGMENTS = {
    // Fragment selections as stored in .svil file
    fragment_selections: {
        'left_finger': FRAGMENT_NAMES.FINGER_5KEY,
        'right_finger': FRAGMENT_NAMES.FINGER_6KEY,
    },

    // Full fragments definition as stored in .svil file
    fragments: createTestFragments(),

    // Composition as stored in .svil file
    composition: createTestComposition(),
};

// ============================================================================
// Pointing slots (zero-key widget fragments), as in the firmware's sval.json.
// ============================================================================

export const POINTING_FRAGMENT_IDS = {
    pointing_none: 4,
    pointing_trackball_pmw3360: 5,
    pointing_trackball_pmw3389: 6,
    pointing_touchpad_azoteq: 7,
    pointing_trackpoint: 8,
    pointing_unknown: 9,
} as const;

export const POINTING_INSTANCE_IDX = { left: 10, right: 11 } as const;

export function createPointingFragments(): Record<string, FragmentDefinition> {
    const w = (module: FragmentWidget['module'], sensor?: FragmentWidget['sensor']): FragmentWidget =>
        ({ kind: 'pointing', module, ...(sensor ? { sensor } : {}), w: 2.5, h: 2.5 });
    return {
        pointing_none: { id: 4, description: 'No pointing module', kle: [], widget: w('none') },
        pointing_trackball_pmw3360: { id: 5, description: 'PMW3360 trackball', kle: [], widget: w('trackball', 'pmw3360') },
        pointing_trackball_pmw3389: { id: 6, description: 'PMW3389 trackball', kle: [], widget: w('trackball', 'pmw3389') },
        pointing_touchpad_azoteq: { id: 7, description: 'Azoteq touchpad', kle: [], widget: w('touchpad', 'azoteq') },
        pointing_trackpoint: { id: 8, description: 'TrackPoint', kle: [], widget: w('trackpoint', 'trackpoint') },
        pointing_unknown: { id: 9, description: 'Unknown pointing module', kle: [], widget: w('unknown') },
    };
}

export function createPointingInstance(side: 'left' | 'right'): FragmentInstance {
    const placement = side === 'left' ? { x: 4.2, y: 5.25 } : { x: 18.3, y: 5.25 };
    return {
        id: `${side}_pointing`,
        hardware_detect: true,
        fragment_options: Object.keys(POINTING_FRAGMENT_IDS).map((fragment, i) => ({
            fragment,
            placement,
            matrix_map: [],
            allow_override: false,
            ...(i === 0 ? { default: true } : {}),
        })),
    } as FragmentInstance;
}

/**
 * The shipped Svalboard definition (fragments + composition from the default
 * layout) with the two pointing instances appended at indices 10 and 11.
 */
export function createSvalboardPointingKbinfo(options?: {
    sixKey?: boolean;
    hwDetection?: [number, number][];
    withPointing?: boolean;
}): KeyboardInfo {
    const svil = JSON.parse(readFileSync(resolvePath(__dirname, '../../src/default-layouts/sval-default.svil'), 'utf8'));
    const kbinfo = createTestKeyboardInfo({ rows: 10, cols: 6, layers: 2, kbid: '5a5a5a5a5a5a5a5a' });
    kbinfo.fragments = { ...svil.fragments, ...(options?.withPointing === false ? {} : createPointingFragments()) };
    kbinfo.composition = {
        instances: [
            ...svil.composition.instances,
            ...(options?.withPointing === false ? [] : [createPointingInstance('left'), createPointingInstance('right')]),
        ],
    };
    const finger = options?.sixKey ? 'finger_6' : 'finger_5';
    kbinfo.fragmentState = createFragmentState({
        hwDetection: options?.hwDetection ?? [],
        userSelections: ['left_pinky', 'left_ring', 'left_middle', 'left_index', 'right_index', 'right_middle', 'right_ring', 'right_pinky']
            .map((id) => [id, finger] as [string, string]),
    });
    return kbinfo;
}
