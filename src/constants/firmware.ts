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

// GET_INFO second feature byte: vLaunch2 is the first release to set it.
const SVIL_FLAG2_DEFAULT_LAYER_SET = 0x01;

/**
 * Newest Svalboard QMK release this Keybard knows. Releases are launch tags
 * (vLaunch, vLaunch2, ...) shared by the firmware, Keybard Host and Keybard, so
 * bump this, and teach identifyFirmwareRelease how to tell the new release
 * apart, when a new launch tag ships. Baked into the build: no network lookup.
 */
export const LATEST_FIRMWARE_RELEASE = "vLaunch2";

/** Which Svalboard QMK release a connected board is running, as far as its replies tell. */
export interface FirmwareRelease {
    /** The release, e.g. "vLaunch2", or the releases it could be ("vRC1 or vRC2"). */
    name: string;
    /** Later builds can look the same over HID, so this is the oldest it could be. */
    orLater: boolean;
    /** A newer release than this one exists. */
    outdated: boolean;
}

/** "vLaunch2 or later", "vLaunch", ... */
export function firmwareReleaseLabel(release: FirmwareRelease): string {
    return release.orLater ? `${release.name} or later` : release.name;
}

/**
 * Identify a connected board's firmware release. The firmware doesn't report its
 * release tag or build string over HID, so this goes by what each release added
 * to GET_INFO: vLaunch reports its keycode numbering, vLaunch2 sets the second
 * feature byte. Returns null for loaded files and unsupported protocols.
 */
export function identifyFirmwareRelease(kb: Pick<KeyboardInfo, "svil_proto" | "feature_flags" | "feature_flags2" | "keycode_version_reported">): FirmwareRelease | null {
    // keycode_version_reported is only set for a live connection
    if (kb.keycode_version_reported === undefined || !kb.svil_proto || kb.svil_proto < MIN_SVIL_PROTO) return null;
    if (kb.svil_proto > MIN_SVIL_PROTO) return { name: `newer than ${LATEST_FIRMWARE_RELEASE}`, orLater: false, outdated: false };
    if (!kb.keycode_version_reported) {
        const layerFlags = SVIL_FLAG_CONTEXT_LAYER | SVIL_FLAG_DEFAULT_LAYER_STATE;
        const rc0 = ((kb.feature_flags ?? 0) & layerFlags) === 0;
        return { name: rc0 ? "vRC0" : "vRC1 or vRC2", orLater: false, outdated: true };
    }
    if (((kb.feature_flags2 ?? 0) & SVIL_FLAG2_DEFAULT_LAYER_SET) === 0) return { name: "vLaunch", orLater: false, outdated: true };
    return { name: "vLaunch2", orLater: true, outdated: false };
}

/**
 * "rc0": vRC0, without context or default layer reporting (Trainer can't follow layers).
 * "rc": vRC1 or vRC2 (the two look identical over HID).
 * "launch": vLaunch, before the storage fixes and default-layer setting of vLaunch2.
 */
export type FirmwareUpdateNotice = "rc0" | "rc" | "launch";

/** Which "newer firmware available" notice a connected board gets, if any. */
export function firmwareUpdateNotice(kb: Pick<KeyboardInfo, "svil_proto" | "feature_flags" | "feature_flags2" | "keycode_version_reported">): FirmwareUpdateNotice | null {
    const release = identifyFirmwareRelease(kb);
    if (!release?.outdated) return null;
    if (release.name === "vRC0") return "rc0";
    return release.name === "vLaunch" ? "launch" : "rc";
}

/**
 * One line naming a connected board's firmware, for status text and tooltips:
 * its own build string when it reports one, else the release it was identified as.
 */
export function describeFirmware(kb: Pick<KeyboardInfo, "svil_proto" | "feature_flags" | "feature_flags2" | "keycode_version_reported" | "sval_firmware">): string | null {
    if (kb.sval_firmware) return kb.sval_firmware;
    const release = identifyFirmwareRelease(kb);
    return release ? `Svalboard QMK ${firmwareReleaseLabel(release)}` : null;
}
