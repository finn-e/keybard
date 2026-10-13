import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';

import PointingHardwareSummary from '../../src/components/PointingHardwareSummary';
import { parsePointingHardware, type PointingHardwareReport } from '../../src/utils/pointing-hardware';
import { POINTING_MAX_READS, POINTING_RETRY_MS } from '../../src/hooks/usePointingHardware';

const LEFT = 0x03, RIGHT = 0x01;
const NONE = 0, PMW3389 = 2, NOTHING = 3, AZOTEQ = 5, TRACKPOINT = 6;
const report = (usb: number[], other: number[] = [0, 0, 0, 0, 0]) =>
    parsePointingHardware(new Uint8Array([0x2c, 1, ...usb, ...other]))!;

const ctx = { keyboard: {} as { pointing_hardware?: PointingHardwareReport }, isConnected: true, connectionSessionId: 1 };
const replies: (PointingHardwareReport | undefined)[] = [];
const getPointingHardware = vi.fn(async (kb: { pointing_hardware?: PointingHardwareReport }) => {
    kb.pointing_hardware = replies.length > 1 ? replies.shift() : replies[0];
});

vi.mock('@/contexts/KeyboardContext', () => ({ useKeyboard: () => ctx }));
vi.mock('@/services/keyboard.service', () => ({ keyboardService: { getPointingHardware: (kb: never) => getPointingHardware(kb) } }));

const rows = () => [...screen.getByTestId('pointing-hardware-summary').querySelectorAll('dd')].map((d) => d.textContent);
const tick = () => act(async () => { await vi.advanceTimersByTimeAsync(POINTING_RETRY_MS); });

describe('PointingHardwareSummary', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        getPointingHardware.mockClear();
        replies.length = 0;
        ctx.isConnected = true;
    });
    afterEach(() => vi.useRealTimers());

    it('renders nothing on firmware without the report', () => {
        ctx.keyboard = {};
        replies.push(undefined);
        const { container } = render(<PointingHardwareSummary />);
        expect(container).toBeEmptyDOMElement();
    });

    it('shows a settled report without reading again', async () => {
        ctx.keyboard = { pointing_hardware: report([LEFT, TRACKPOINT, TRACKPOINT, 0, 0], [RIGHT, PMW3389, PMW3389, 0x47, 0xb8]) };
        render(<PointingHardwareSummary />);
        expect(rows()).toEqual(['TrackPoint', 'PMW3389 trackball']);
        await tick();
        expect(getPointingHardware).not.toHaveBeenCalled();
    });

    it('reads again until the other half reports and both have checked', async () => {
        ctx.keyboard = { pointing_hardware: report([LEFT, NONE, 0, 0, 0]) };
        replies.push(
            report([LEFT, NONE, NOTHING, 0, 0]),
            report([LEFT, NONE, NOTHING, 0, 0], [RIGHT, NONE, AZOTEQ, 0, 40]),
        );
        render(<PointingHardwareSummary />);
        expect(rows()).toEqual(['Checking…', 'Not reporting']);
        await tick();
        expect(rows()).toEqual(['None', 'Not reporting']);
        await tick();
        expect(rows()).toEqual(['None', 'Azoteq trackpad (wrong firmware)']);
        await tick();
        expect(getPointingHardware).toHaveBeenCalledTimes(2);
    });

    it('gives up after a few seconds when a half never reports', async () => {
        ctx.keyboard = { pointing_hardware: report([LEFT, NONE, NOTHING, 0, 0]) };
        replies.push(report([LEFT, NONE, NOTHING, 0, 0]));
        render(<PointingHardwareSummary />);
        for (let i = 0; i < POINTING_MAX_READS + 3; i++) await tick();
        expect(getPointingHardware).toHaveBeenCalledTimes(POINTING_MAX_READS);
        expect(rows()).toEqual(['None', 'Not reporting']);
    });

    it('renders nothing while disconnected', () => {
        ctx.isConnected = false;
        ctx.keyboard = { pointing_hardware: report([LEFT, TRACKPOINT, TRACKPOINT, 0, 0]) };
        const { container } = render(<PointingHardwareSummary />);
        expect(container).toBeEmptyDOMElement();
    });
});
