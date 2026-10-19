import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// A fresh connect must never leave pending changes or write to the board.
// The board here is a Svalboard as it ships: 256 tap dance slots, a handful
// configured, and every unused slot stored as zeros (term 0, enabled bit off).

const h = vi.hoisted(() => ({
    probe: { current: null as null | { pending: () => number; dirty: boolean; state: string; kb: any; setKeyboard: (kb: any) => void; queue: any; commit: () => Promise<boolean> } },
    sent: [] as Array<{ cmd: number; args: number[] }>,
    connect: null as null | (() => Promise<boolean>),
}));

vi.mock('../../src/components/MainScreen', async () => {
    const { useChanges } = await import('../../src/contexts/ChangesContext');
    const { useKeyboard } = await import('../../src/contexts/KeyboardContext');
    return {
        default: function Probe() {
            const changes = useChanges();
            const kb = useKeyboard();
            h.probe.current = {
                pending: changes.getPendingCount,
                dirty: kb.hasUnsavedChanges,
                state: kb.connectionState,
                kb: kb.keyboard,
                setKeyboard: kb.setKeyboard,
                queue: changes.queue,
                commit: changes.commit,
            };
            return null;
        },
    };
});
vi.mock('../../src/components/PrintableKeymapWrapper', () => ({ default: () => null }));
vi.mock('../../src/components/ChannelBanner', () => ({ default: () => null }));
vi.mock('../../src/components/DeployBadge', () => ({ default: () => null }));

const TD_SLOTS = 256;
const CONFIGURED = 10;

vi.mock('../../src/services/usb.service', async (importOriginal) => {
    const real = await importOriginal<typeof import('../../src/services/usb.service')>();
    const { SvilUSB } = real;
    // Answers a v3 table scan of the tap dance table: slots 0..CONFIGURED-1 are
    // configured (KC_A on tap, 200 ms, on); every other slot is empty zeros.
    const sendSvil = vi.fn(async (cmd: number, args: number[]) => {
        h.sent.push({ cmd, args });
        if (cmd === SvilUSB.CMD_SVIL_TABLE_SCAN) {
            const start = args[1] | (args[2] << 8);
            if (start >= CONFIGURED) return new Uint8Array([cmd, 0, 0]);
            const out = new Uint8Array(32);
            out.set([cmd, 0, 1, start & 255, start >> 8]);
            const term = 200 | 0x8000;
            out.set([4, 0, 0, 0, 0, 0, 0, 0, term & 255, term >> 8], 5);
            return out;
        }
        return new Uint8Array([cmd, 0]);
    });
    const usbInstance = {
        svilProtocolVersion: 3,
        sendSvil,
        openDevice: vi.fn(async () => true),
        hasDevice: vi.fn(() => false),
        close: vi.fn(async () => undefined),
        getDeviceName: vi.fn(() => 'Svalboard'),
        getAllLayerColors: vi.fn(async () => []),
        onDisconnect: null,
    };
    class FakeSvilUSB extends SvilUSB {}
    (FakeSvilUSB as any).requestDevice = vi.fn(async () => ({ productName: 'Svalboard' }));
    (FakeSvilUSB as any).checkFirmware = vi.fn(async () => undefined);
    return { ...real, usbInstance, SvilUSB: FakeSvilUSB };
});

vi.mock('../../src/services/keyboard.service', async (importOriginal) => {
    const real = await importOriginal<typeof import('../../src/services/keyboard.service')>();
    const { usbInstance } = await import('../../src/services/usb.service');
    const { TapdanceService } = await import('../../src/services/tapdance.service');
    const tapdance = new TapdanceService(usbInstance as any);
    const keyboardService = Object.assign(Object.create(Object.getPrototypeOf(real.keyboardService)), real.keyboardService, {
        init: vi.fn(async () => undefined),
        // The real tap dance read, on a board with the counts Svalboard QMK reports.
        load: vi.fn(async (kb: any) => {
            Object.assign(kb, { rows: 1, cols: 1, layers: 1, keymap: [[4]], svil_proto: 3, tapdance_count: TD_SLOTS });
            await tapdance.get(kb);
            return kb;
        }),
        updateTapdance: vi.fn(async (kb: any, idx: number) => tapdance.push(kb, idx)),
        saveSvil: vi.fn(async () => undefined),
        getActiveLayerIndex: vi.fn(async () => 0),
        getLayerIndexes: vi.fn(async () => ({ active: 0, defaultLayer: null })),
    });
    return { ...real, keyboardService };
});

vi.mock('../../src/services/qmk.service', async (importOriginal) => {
    const real = await importOriginal<typeof import('../../src/services/qmk.service')>();
    return { ...real, qmkService: Object.assign(Object.create(Object.getPrototypeOf(real.qmkService)), real.qmkService, { get: vi.fn(async () => undefined) }) };
});

vi.mock('../../src/components/ThemeSync', async () => {
    const { useKeyboard } = await import('../../src/contexts/KeyboardContext');
    return { default: function Grab() { h.connect = useKeyboard().connect as any; return null; } };
});

import App from '../../src/App';
import { SettingsService } from '../../src/services/settings.service';
import { SvilUSB } from '../../src/services/usb.service';

const writes = () => h.sent.filter(s => s.cmd !== SvilUSB.CMD_SVIL_TABLE_SCAN);

describe('connecting a board', () => {
    beforeEach(() => { h.sent.length = 0; localStorage.clear(); });

    it.each([['manual', false], ['live', true]] as const)('leaves zero pending changes and writes nothing (%s updates)', async (_mode, live) => {
        vi.spyOn(SettingsService.prototype, 'load').mockReturnValue({ 'live-updating': live } as any);
        render(<App />);
        await waitFor(() => expect(h.connect).toBeTruthy());
        await act(async () => { await h.connect!(); });
        await waitFor(() => expect(h.probe.current?.state).toBe('connected'));
        // Let any connect-time effects run.
        await act(async () => { await new Promise(r => setTimeout(r, 50)); });
        const p = h.probe.current!;
        expect(p.kb.tapdances).toHaveLength(TD_SLOTS);
        expect(p.pending()).toBe(0);
        expect(p.dirty).toBe(false);
        expect(writes()).toEqual([]);
        // Unused slots read back with a usable term, so editing one writes it.
        expect(p.kb.tapdances[200].tapping_term).toBe(200);
        expect(p.kb.tapdances[0]).toMatchObject({ tap: 'KC_A', tapping_term: 200, enabled: true });
    });

    it('still counts and writes an edit, with the usable term, after connect', async () => {
        vi.spyOn(SettingsService.prototype, 'load').mockReturnValue({ 'live-updating': false } as any);
        render(<App />);
        await waitFor(() => expect(h.connect).toBeTruthy());
        await act(async () => { await h.connect!(); });
        await waitFor(() => expect(h.probe.current?.state).toBe('connected'));
        const { keyboardService } = await import('../../src/services/keyboard.service');
        await act(async () => {
            const p = h.probe.current!;
            const next = { ...p.kb, tapdances: p.kb.tapdances.map((t: any) => t.idx === 200 ? { ...t, tap: 'KC_B' } : t) };
            p.setKeyboard(next);
            await p.queue('tapdance 200', () => keyboardService.updateTapdance(next, 200), { type: 'tapdance', tapdanceId: 200, writeKey: 'tapdance:200' });
        });
        expect(h.probe.current!.pending()).toBe(1);
        expect(h.probe.current!.dirty).toBe(true);
        expect(writes()).toEqual([]);
        await act(async () => { await h.probe.current!.commit(); });
        const set = writes().filter(w => w.cmd === SvilUSB.CMD_SVIL_TAP_DANCE_SET);
        expect(set).toHaveLength(1);
        // [index:2][tap:2][hold:2][doubletap:2][taphold:2][term|on:2]
        expect(set[0].args.slice(0, 2)).toEqual([200, 0]);
        expect(set[0].args.slice(-2)).toEqual([200, 0x80]);
        expect(h.probe.current!.pending()).toBe(0);
    });
});

