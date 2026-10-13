import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { parsePointingHardware, summarizePointingHardware, type PointingHardwareReport } from '../../src/utils/pointing-hardware';
import { POINTING_MAX_READS, POINTING_RETRY_MS, usePointingHardware } from '../../src/hooks/usePointingHardware';

// Moved from the deleted PointingHardwareSummary test: the hook stays for the
// mismatch dialog and the pointing slot tooltip.
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

const modules = (r: PointingHardwareReport | undefined) => summarizePointingHardware(r).map((h) => h.module);
const tick = () => act(async () => { await vi.advanceTimersByTimeAsync(POINTING_RETRY_MS); });

describe('usePointingHardware', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        getPointingHardware.mockClear();
        replies.length = 0;
        ctx.isConnected = true;
    });
    afterEach(() => vi.useRealTimers());

    it('returns a settled report without reading again', async () => {
        ctx.keyboard = { pointing_hardware: report([LEFT, TRACKPOINT, TRACKPOINT, 0, 0], [RIGHT, PMW3389, PMW3389, 0x47, 0xb8]) };
        const { result } = renderHook(() => usePointingHardware());
        expect(modules(result.current)).toEqual(['trackpoint', 'pmw3389']);
        await tick();
        expect(getPointingHardware).not.toHaveBeenCalled();
    });

    it('reads again until the other half reports and both have checked', async () => {
        ctx.keyboard = { pointing_hardware: report([LEFT, NONE, 0, 0, 0]) };
        replies.push(
            report([LEFT, NONE, NOTHING, 0, 0]),
            report([LEFT, NONE, NOTHING, 0, 0], [RIGHT, NONE, AZOTEQ, 0, 40]),
        );
        const { result } = renderHook(() => usePointingHardware());
        expect(modules(result.current)).toEqual(['checking', 'silent']);
        await tick();
        expect(modules(result.current)).toEqual(['none', 'silent']);
        await tick();
        expect(modules(result.current)).toEqual(['none', 'azoteq']);
        await tick();
        expect(getPointingHardware).toHaveBeenCalledTimes(2);
    });

    it('gives up after a few seconds when a half never reports', async () => {
        ctx.keyboard = { pointing_hardware: report([LEFT, NONE, NOTHING, 0, 0]) };
        replies.push(report([LEFT, NONE, NOTHING, 0, 0]));
        renderHook(() => usePointingHardware());
        for (let i = 0; i < POINTING_MAX_READS + 3; i++) await tick();
        expect(getPointingHardware).toHaveBeenCalledTimes(POINTING_MAX_READS);
    });

    it('returns nothing while disconnected', () => {
        ctx.isConnected = false;
        ctx.keyboard = { pointing_hardware: report([LEFT, TRACKPOINT, TRACKPOINT, 0, 0]) };
        const { result } = renderHook(() => usePointingHardware());
        expect(result.current).toBeUndefined();
    });
});
