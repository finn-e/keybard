import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ConnectKeyboard from '../../src/components/ConnectKeyboard';
import { listPermittedDevices } from '../../src/contexts/KeyboardContext';
import type { UnsupportedFirmwareInfo } from '../../src/utils/unsupported-firmware';

const keyboardContext = {
    isConnected: false,
    isWebHIDSupported: true,
    connect: vi.fn(),
    connectDevice: vi.fn(),
    disconnect: vi.fn(),
    loadKeyboard: vi.fn(),
    loadFromFile: vi.fn(),
    connectionError: null as string | null,
    connectionFix: null as string | null,
    connectionFirmware: null as UnsupportedFirmwareInfo | null,
};

vi.mock('@/contexts/KeyboardContext', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/contexts/KeyboardContext')>();
    return { ...actual, useKeyboard: () => keyboardContext };
});

const fakeDevice = (productName: string, productId: number, collections: Array<[number, number]>) => ({
    vendorId: 0x303a,
    productId,
    productName,
    opened: false,
    collections: collections.map(([usagePage, usage]) => ({ usagePage, usage })),
}) as unknown as HIDDevice;

describe('listPermittedDevices', () => {
    it('preserves distinct identical keyboards whose interfaces match', async () => {
        const hid = navigator.hid as unknown as { getDevices: ReturnType<typeof vi.fn> };
        hid.getDevices.mockResolvedValue([
            fakeDevice('Svalboard ScanLab', 0x4044, [[0xff31, 0x74]]),   // console interface: no
            fakeDevice('Svalboard ScanLab', 0x4044, [[0xff61, 0x62]]),   // raw HID: yes
            fakeDevice('Svalboard ScanLab', 0x4044, [[0x01, 0x06]]),     // keyboard: no
            fakeDevice('lightly', 0x4049, [[0xff61, 0x62]]),             // second board: yes
            fakeDevice('lightly', 0x4049, [[0xff61, 0x62]]),             // duplicate interface entry
        ]);
        const devices = await listPermittedDevices();
        expect(devices.map((d) => d.productName)).toEqual(['Svalboard ScanLab', 'lightly', 'lightly']);
    });
});

describe('ConnectKeyboard: reconnect to permitted keyboards', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        keyboardContext.isConnected = false;
        keyboardContext.isWebHIDSupported = true;
        keyboardContext.connectionError = null;
        keyboardContext.connectionFix = null;
        keyboardContext.connectionFirmware = null;
    });

    it('lists permitted keyboards and opens one without the chooser', async () => {
        const hid = navigator.hid as unknown as { getDevices: ReturnType<typeof vi.fn> };
        const scanlab = fakeDevice('Svalboard ScanLab', 0x4044, [[0xff61, 0x62]]);
        hid.getDevices.mockResolvedValue([scanlab]);
        keyboardContext.connectDevice.mockResolvedValue(true);

        render(<ConnectKeyboard />);
        const button = await screen.findByRole('button', { name: 'Svalboard ScanLab' });
        fireEvent.click(button);
        await waitFor(() => expect(keyboardContext.connectDevice).toHaveBeenCalledWith(scanlab));
        expect(keyboardContext.connect).not.toHaveBeenCalled();
    });

    it('shows nothing extra when no keyboard has been permitted', async () => {
        render(<ConnectKeyboard />);
        expect(screen.getByRole('button', { name: /Connect Keyboard/ })).toBeInTheDocument();
        await waitFor(() => expect((navigator.hid as unknown as { getDevices: ReturnType<typeof vi.fn> }).getDevices).toHaveBeenCalled());
        expect(screen.queryByTestId('known-devices')).not.toBeInTheDocument();
    });
    it('explains unsupported connections while still allowing offline files and demo', async () => {
        keyboardContext.isWebHIDSupported = false;
        render(<ConnectKeyboard />);
        expect(screen.getByText('Browser Not Supported')).toBeInTheDocument();
        expect(screen.getByRole('button', {name: 'Connect Keyboard'})).toBeDisabled();
        expect(screen.getByRole('button', {name: 'Load File'})).toBeEnabled();
        expect(screen.getByRole('button', {name: 'QWERTY Example'})).toBeEnabled();
        await waitFor(() => expect(navigator.hid.getDevices).toHaveBeenCalled());
    });

    it('shows the udev commands with a copy button when Linux blocks the device', async () => {
        keyboardContext.connectionError = 'Linux blocked access to the keyboard.';
        keyboardContext.connectionFix = 'echo rule | sudo tee /etc/udev/rules.d/60-svalboard.rules';
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        render(<ConnectKeyboard />);
        expect(screen.getByRole('alert')).toHaveTextContent('Linux blocked access');
        expect(screen.getByLabelText('udev rule commands')).toHaveTextContent('60-svalboard.rules');
        fireEvent.click(screen.getByRole('button', { name: 'Copy commands' }));
        expect(writeText).toHaveBeenCalledWith(keyboardContext.connectionFix);
        expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
        await waitFor(() => expect(navigator.hid.getDevices).toHaveBeenCalled());
    });

    it('explains old Vial firmware with the manual install instead of the raw error', async () => {
        keyboardContext.connectionError = 'This Svalboard is running the old Vial firmware (v2025-11-01).';
        keyboardContext.connectionFirmware = { kind: 'svalboard-vial', reportedVersion: 'v2025-11-01' };
        render(<ConnectKeyboard />);
        const card = screen.getByRole('alert', { name: "Update your Svalboard's firmware" });
        expect(card).toHaveTextContent('old Vial firmware (v2025-11-01)');
        expect(card).toHaveTextContent('File > Save current layout');
        expect(screen.getByRole('button', { name: 'Install by hand' })).toBeInTheDocument();
        expect(screen.getAllByRole('alert')).toHaveLength(1);
        await waitFor(() => expect(navigator.hid.getDevices).toHaveBeenCalled());
    });

    it('shows file errors as alerts without reconnecting on click', async () => {
        keyboardContext.loadFromFile.mockRejectedValueOnce('Empty file');
        const {container} = render(<ConnectKeyboard />);
        fireEvent.change(container.querySelector('input[type=file]')!, {target: {files: [new File([''], 'empty.svil')]}});
        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('Empty file');
        fireEvent.click(alert);
        expect(keyboardContext.connect).not.toHaveBeenCalled();
    });

});

// The host must not add launchers or connection-policy copy to Keybard's landing page.
describe('ConnectKeyboard landing content', () => {
    it('keeps the original landing page in host mode', () => {
        document.documentElement.dataset.keybardHost = 'true';
        try {
            render(<ConnectKeyboard />);
            expect(screen.queryByText(/trainer/i)).not.toBeInTheDocument();
            expect(screen.queryByText(/Keybard Overlay|owns the board|device editing/i)).not.toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'QWERTY Example' })).toBeInTheDocument();
        } finally {
            delete document.documentElement.dataset.keybardHost;
        }
    });
});
