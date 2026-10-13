import { describe, it, expect } from 'vitest';
import { LinuxHidAccessError, isLinuxUserAgent, toHidOpenError, udevRuleCommand } from '../../src/utils/linux-hid-access';

const LINUX = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';

const device = { vendorId: 0x303a, productId: 0x4044 } as HIDDevice;
const notAllowed = () => new DOMException('Failed to open the device.', 'NotAllowedError');

describe('linux HID access', () => {
    it('recognises desktop Linux but not Android or Windows', () => {
        expect(isLinuxUserAgent(LINUX)).toBe(true);
        expect(isLinuxUserAgent(ANDROID)).toBe(false);
        expect(isLinuxUserAgent(WINDOWS)).toBe(false);
    });

    it('builds a udev rule for the device IDs, not the serial number', () => {
        const command = udevRuleCommand(0x303a, 0x4049);
        expect(command).toContain('ATTRS{idVendor}=="303a"');
        expect(command).toContain('TAG+="uaccess"');
        expect(command).not.toContain('serial');
        expect(command).toContain('sudo udevadm trigger --subsystem-match=hidraw');
    });

    it('writes one rule that matches every Svalboard product ID', () => {
        const rule = 'KERNEL=="hidraw*", SUBSYSTEM=="hidraw", ATTRS{idVendor}=="303a", ATTRS{idProduct}=="404[4-9a-d]", MODE="0660", TAG+="uaccess"';
        for (const pid of [0x4044, 0x4045, 0x4046, 0x4049, 0x404a, 0x404d]) {
            expect(udevRuleCommand(0x303a, pid).split('\n')).toEqual([
                "sudo tee /etc/udev/rules.d/60-svalboard.rules > /dev/null <<'EOF'",
                rule,
                'EOF',
                'sudo udevadm control --reload',
                'sudo udevadm trigger --subsystem-match=hidraw',
            ]);
        }
        // The glob covers exactly 0x4044-0x404D.
        const glob = /^404[4-9a-d]$/;
        for (let pid = 0x4040; pid <= 0x4050; pid++) {
            expect(glob.test(pid.toString(16))).toBe(pid >= 0x4044 && pid <= 0x404d);
        }
    });

    it('keeps the exact product ID for devices outside the Svalboard range', () => {
        expect(udevRuleCommand(0x303a, 0x1001)).toContain('ATTRS{idProduct}=="1001"');
        expect(udevRuleCommand(0x1234, 0x4044)).toContain('ATTRS{idVendor}=="1234", ATTRS{idProduct}=="4044"');
    });

    it('turns NotAllowedError on Linux into LinuxHidAccessError', () => {
        const original = notAllowed();
        const translated = toHidOpenError(original, device, LINUX);
        expect(translated).toBeInstanceOf(LinuxHidAccessError);
        expect((translated as LinuxHidAccessError).udevCommand).toBe(udevRuleCommand(0x303a, 0x4044));
        expect((translated as Error & { cause?: unknown }).cause).toBe(original);
    });

    it('passes other errors and other platforms through unchanged', () => {
        const original = notAllowed();
        expect(toHidOpenError(original, device, WINDOWS)).toBe(original);
        const other = new DOMException('Device busy', 'InvalidStateError');
        expect(toHidOpenError(other, device, LINUX)).toBe(other);
    });
});
