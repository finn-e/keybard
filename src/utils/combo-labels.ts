// Short keycode names for the combo preview readout and accessible labels.
import type { ComboMembership } from "./combo-membership";

const NAMES: Record<string, string> = {
    ESCAPE: "Esc", ESC: "Esc", BSPACE: "Bksp", BSPC: "Bksp", TAB: "Tab", ENTER: "Enter", ENT: "Enter",
    DELETE: "Del", DEL: "Del", MINUS: "-", EQUAL: "=", CAPSLOCK: "Caps", CAPS: "Caps", LGUI: "GUI",
    QUOTE: "'", QUOT: "'", SCOLON: ";", SCLN: ";", BSLASH: "\\", BSLS: "\\", GRAVE: "`", GRV: "`",
    COMMA: ",", COMM: ",", DOT: ".", SLASH: "/", SLSH: "/", LSHIFT: "L Shift", LSFT: "L Shift",
    LCTRL: "L Ctrl", LCTL: "L Ctrl", LALT: "L Alt", SPACE: "Space", SPC: "Space",
};
const MOD: Record<string, string> = {
    LCTL: "Ctrl", LSFT: "Shift", LALT: "Alt", LGUI: "GUI", RCTL: "RCtrl", RSFT: "RShift", RALT: "AltGr", RGUI: "RGUI",
};

/** Short name for a basic keycode Keybard abbreviates ("KC_BSPACE" -> "Bksp"), else undefined. */
export const knownShortName = (s: string): string | undefined => NAMES[s.replace(/^KC_/, "")];

/** "KC_ESCAPE" -> "Esc", "LCTL(KC_C)" -> "Ctrl C", "LGUI_T(KC_TAB)" -> "Tab / GUI". */
export function shortKeyName(s: string | undefined): string {
    if (!s) return "";
    let m: RegExpExecArray | null;
    if ((m = /^(\w+)_T\((.+)\)$/.exec(s))) return shortKeyName(m[2]) + " / " + (MOD[m[1]] || m[1]);
    if ((m = /^(LCTL|LSFT|LALT|LGUI|RCTL|RSFT|RALT|RGUI)\((.+)\)$/.exec(s))) return MOD[m[1]] + " " + shortKeyName(m[2]);
    const b = s.replace(/^KC_/, "");
    return NAMES[b] || (b.length === 1 ? b : b.charAt(0) + b.slice(1).toLowerCase());
}

/** "Combo 3, off: J plus K gives Esc" */
export function comboSentence(c: ComboMembership): string {
    return `Combo ${c.index}${c.enabled ? "" : ", off"}: ${c.inputs.map(shortKeyName).join(" plus ")} gives ${shortKeyName(c.output)}`;
}

/** Accessible label for a key in one or more combos. */
export function keyComboAriaLabel(keyName: string, ms: ComboMembership[]): string {
    return `${keyName}: in ${ms.length} combo${ms.length > 1 ? "s" : ""}. ${ms.map(comboSentence).join(". ")}`;
}
