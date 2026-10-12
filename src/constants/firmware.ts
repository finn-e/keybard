// Svalboard QMK firmware: where to get it, and which builds Keybard asks to update.
import type { KeyboardInfo } from "../types/keyboard.types";

/** Latest Svalboard QMK release; its assets are one .uf2 per board variant. */
export const SVALBOARD_FIRMWARE_URL = "https://github.com/svalboard/qmk/releases/latest";

/**
 * Oldest Sval protocol Keybard connects to. Protocol 1 and 2 builds were never
 * released, and they number keycodes as QMK 0.0.8 without saying so; Keybard
 * would read and write those keys as 0.0.9.
 */
export const MIN_SVIL_PROTO = 3;

// GET_INFO feature flags every release from vRC1 on sets.
const SVIL_FLAG_CONTEXT_LAYER = 0x20;
const SVIL_FLAG_DEFAULT_LAYER_STATE = 0x40;

/**
 * "rc0": vRC0, without context or default layer reporting (the overlay can't follow layers).
 * "rc": vRC1 or vRC2 (the two look identical over HID).
 */
export type FirmwareUpdateNotice = "rc0" | "rc";

/**
 * Which "newer firmware available" notice a connected board gets, if any. The
 * firmware reports no release tag, so this goes by what changed between releases:
 * vLaunch is the first to report its keycode numbering in GET_INFO.
 */
export function firmwareUpdateNotice(kb: Pick<KeyboardInfo, "svil_proto" | "feature_flags" | "keycode_version_reported">): FirmwareUpdateNotice | null {
    // Only known for a live connection; files and newer protocols get nothing.
    if (kb.keycode_version_reported !== false || kb.svil_proto !== MIN_SVIL_PROTO) return null;
    const layerFlags = SVIL_FLAG_CONTEXT_LAYER | SVIL_FLAG_DEFAULT_LAYER_STATE;
    return ((kb.feature_flags ?? 0) & layerFlags) === 0 ? "rc0" : "rc";
}
