// Combo fixtures for the folded-corner tests: the Svalboard default layout (layers 0 and 1,
// keycode strings in matrix order) with the 20 combos of the design review. The first 12 are
// the "demo" set, built so layer-0 keys carry 1 to 5 combos; all 20 are the "dense" set.
export interface FixtureCombo { keys: string[]; output: string; on: boolean }
export const DEMO_COMBO_COUNT = 12;
export const FIXTURE_COMBOS: FixtureCombo[] = [
    {
        "keys": [
            "KC_J",
            "KC_K",
            "KC_NO",
            "KC_NO"
        ],
        "output": "KC_ESCAPE",
        "on": true
    },
    {
        "keys": [
            "KC_K",
            "KC_L",
            "KC_NO",
            "KC_NO"
        ],
        "output": "KC_BSPACE",
        "on": true
    },
    {
        "keys": [
            "KC_D",
            "KC_F",
            "KC_NO",
            "KC_NO"
        ],
        "output": "KC_TAB",
        "on": true
    },
    {
        "keys": [
            "KC_S",
            "KC_D",
            "KC_NO",
            "KC_NO"
        ],
        "output": "LCTL(KC_C)",
        "on": true
    },
    {
        "keys": [
            "KC_D",
            "KC_K",
            "KC_NO",
            "KC_NO"
        ],
        "output": "KC_ENTER",
        "on": true
    },
    {
        "keys": [
            "KC_D",
            "KC_L",
            "KC_NO",
            "KC_NO"
        ],
        "output": "KC_DELETE",
        "on": true
    },
    {
        "keys": [
            "KC_E",
            "KC_R",
            "KC_NO",
            "KC_NO"
        ],
        "output": "KC_MINUS",
        "on": true
    },
    {
        "keys": [
            "KC_W",
            "KC_E",
            "KC_NO",
            "KC_NO"
        ],
        "output": "KC_EQUAL",
        "on": true
    },
    {
        "keys": [
            "KC_E",
            "KC_I",
            "KC_NO",
            "KC_NO"
        ],
        "output": "LCTL(KC_Z)",
        "on": true
    },
    {
        "keys": [
            "KC_E",
            "KC_O",
            "KC_NO",
            "KC_NO"
        ],
        "output": "LCTL(KC_V)",
        "on": true
    },
    {
        "keys": [
            "KC_E",
            "KC_U",
            "KC_NO",
            "KC_NO"
        ],
        "output": "KC_CAPSLOCK",
        "on": false
    },
    {
        "keys": [
            "LGUI_T(KC_TAB)",
            "KC_LSHIFT",
            "KC_NO",
            "KC_NO"
        ],
        "output": "KC_LGUI",
        "on": true
    },
    {
        "keys": [
            "KC_A",
            "KC_S",
            "KC_NO",
            "KC_NO"
        ],
        "output": "LCTL(KC_A)",
        "on": true
    },
    {
        "keys": [
            "KC_F",
            "KC_J",
            "KC_NO",
            "KC_NO"
        ],
        "output": "KC_QUOTE",
        "on": true
    },
    {
        "keys": [
            "KC_R",
            "KC_U",
            "KC_NO",
            "KC_NO"
        ],
        "output": "LCTL(KC_Y)",
        "on": true
    },
    {
        "keys": [
            "KC_C",
            "KC_V",
            "KC_NO",
            "KC_NO"
        ],
        "output": "LCTL(KC_X)",
        "on": true
    },
    {
        "keys": [
            "KC_M",
            "KC_COMMA",
            "KC_NO",
            "KC_NO"
        ],
        "output": "KC_SCOLON",
        "on": true
    },
    {
        "keys": [
            "KC_I",
            "KC_O",
            "KC_NO",
            "KC_NO"
        ],
        "output": "KC_BSLASH",
        "on": true
    },
    {
        "keys": [
            "KC_S",
            "KC_L",
            "KC_NO",
            "KC_NO"
        ],
        "output": "LCTL(KC_S)",
        "on": true
    },
    {
        "keys": [
            "KC_X",
            "KC_C",
            "KC_NO",
            "KC_NO"
        ],
        "output": "KC_GRAVE",
        "on": true
    }
];
export const FIXTURE_LAYERS: string[][] = [["KC_LCTRL", "LGUI_T(KC_TAB)", "KC_LSHIFT", "LT1(KC_ENTER)", "KC_NO", "KC_CAPSLOCK", "KC_V", "KC_G", "KC_F", "KC_R", "KC_DQUO", "KC_NO", "KC_C", "KC_T", "KC_D", "KC_E", "KC_GRAVE", "KC_NO", "KC_X", "KC_B", "KC_S", "KC_W", "KC_ESCAPE", "KC_NO", "KC_Z", "KC_LBRACKET", "KC_A", "KC_Q", "KC_DELETE", "KC_NO", "KC_LALT", "KC_BSPACE", "MO(1)", "KC_SPACE", "KC_NO", "MO(2)", "KC_M", "KC_QUOTE", "KC_J", "KC_U", "KC_H", "KC_NO", "KC_COMMA", "KC_COLN", "KC_K", "KC_I", "KC_Y", "KC_NO", "KC_DOT", "LT14(KC_NO)", "KC_L", "KC_O", "KC_N", "KC_NO", "KC_SLASH", "KC_BSLASH", "KC_SCOLON", "KC_P", "KC_RBRACKET", "KC_NO"], ["KC_TRNS", "KC_TRNS", "KC_TRNS", "KC_TRNS", "KC_TRNS", "KC_TRNS", "KC_END", "KC_5", "KC_4", "KC_DLR", "KC_PERC", "KC_NO", "KC_PGDOWN", "KC_MINUS", "KC_3", "KC_HASH", "KC_PLUS", "KC_NO", "KC_PGUP", "KC_DOT", "KC_2", "KC_AT", "KC_TRNS", "KC_NO", "KC_HOME", "KC_EQUAL", "KC_1", "KC_EXLM", "KC_TRNS", "KC_NO", "KC_TRNS", "KC_TRNS", "KC_TRNS", "KC_TRNS", "KC_TRNS", "KC_TRNS", "KC_LEFT", "KC_CIRC", "KC_7", "KC_AMPR", "KC_6", "KC_NO", "KC_UP", "KC_NO", "KC_8", "KC_ASTR", "KC_UNDS", "KC_NO", "KC_DOWN", "KC_NO", "KC_9", "KC_LPRN", "KC_INSERT", "KC_NO", "KC_RIGHT", "KC_NO", "KC_0", "KC_RPRN", "KC_TILD", "KC_NO"]];
export const FIXTURE_LAYER_COLORS: Record<string, string> = {"0": "green", "1": "orange"};
