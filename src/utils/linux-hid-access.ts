/**
 * Linux keeps /dev/hidraw* root-only unless a udev rule grants access. Chrome's
 * WebHID permission is only the site grant, so a device the chooser offered can
 * still fail to open with NotAllowedError. Older Svalboard setups matched the
 * Vial serial number, which current firmware no longer reports, so this is the
 * usual failure after a firmware update on Linux.
 */

const hex4 = (id: number) => id.toString(16).padStart(4, "0");

export function isLinuxUserAgent(userAgent: string = navigator.userAgent): boolean {
    return /Linux/.test(userAgent) && !/Android/.test(userAgent);
}

/** Svalboard's USB vendor ID and the product IDs its firmware files use (0x4044-0x404D). */
const SVALBOARD_VID = 0x303a;
const SVALBOARD_PIDS = { first: 0x4044, last: 0x404d };
/** udev glob matching every Svalboard product ID, so one rule covers every firmware file. */
const SVALBOARD_PID_GLOB = "404[4-9a-d]";

/** The idProduct match for a device: every Svalboard ID for a Svalboard, else the exact ID. */
function productMatch(vendorId: number, productId: number): string {
    const svalboard = vendorId === SVALBOARD_VID && productId >= SVALBOARD_PIDS.first && productId <= SVALBOARD_PIDS.last;
    return svalboard ? SVALBOARD_PID_GLOB : hex4(productId);
}

/**
 * Shell commands that install a udev rule for this device and apply it. For a
 * Svalboard the rule matches every Svalboard product ID, so it keeps working
 * after flashing a firmware file with a different ID, and running it never
 * narrows a broader rule already in 60-svalboard.rules.
 */
export function udevRuleCommand(vendorId: number, productId: number): string {
    const rule = `KERNEL=="hidraw*", SUBSYSTEM=="hidraw", ATTRS{idVendor}=="${hex4(vendorId)}", ATTRS{idProduct}=="${productMatch(vendorId, productId)}", MODE="0660", TAG+="uaccess"`;
    return [
        `sudo tee /etc/udev/rules.d/60-svalboard.rules > /dev/null <<'EOF'`,
        rule,
        `EOF`,
        `sudo udevadm control --reload`,
        `sudo udevadm trigger --subsystem-match=hidraw`,
    ].join("\n");
}

export class LinuxHidAccessError extends Error {
    readonly udevCommand: string;

    constructor(vendorId: number, productId: number, cause?: unknown) {
        super("Linux blocked access to the keyboard. Add a udev rule for it, then unplug and replug the board and connect again.");
        this.name = "LinuxHidAccessError";
        this.udevCommand = udevRuleCommand(vendorId, productId);
        if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
    }
}

/** Translate a failed HIDDevice.open() into LinuxHidAccessError when it is the udev case. */
export function toHidOpenError(error: unknown, device: HIDDevice, userAgent?: string): unknown {
    const name = (error as { name?: unknown } | null)?.name;
    if (name === "NotAllowedError" && isLinuxUserAgent(userAgent)) {
        return new LinuxHidAccessError(device.vendorId, device.productId, error);
    }
    return error;
}
