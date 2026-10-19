import { describe, it, expect, vi } from 'vitest';
import { TapdanceService } from '../../src/services/tapdance.service';
import { SvilUSB } from '../../src/services/usb.service';
import { fileService } from '../../src/services/file.service';
import type { KeyboardInfo } from '../../src/types/keyboard.types';
const keyboard = (enabled: boolean | undefined, term = 0): KeyboardInfo => ({ rows: 1, cols: 1, layers: 1, keymap: [[4]], tapdances: [{ idx: 0, tap: 'KC_A', hold: 'KC_B', doubletap: 'KC_C', taphold: 'KC_D', tapping_term: term, enabled }] });
describe('tap dance save fidelity', () => {
    // Tap dances are always on: every write sets the enabled bit.
    it.each([[false, 0, 32768], [true, 0, 32768], [undefined, 200, 32968], [false, 200, 32968], [false, -20, 32768], [false, 40000, 65535]] as const)('writes enabled=%s term=%s as %s', async (enabled, term, expected) => {
        const sendSvil = vi.fn().mockResolvedValue(new Uint8Array([SvilUSB.CMD_SVIL_TAP_DANCE_SET, 0]));
        const service = new TapdanceService({ sendSvil, svilProtocolVersion: 3 } as unknown as SvilUSB);
        await service.push(keyboard(enabled, term), 0);
        const bytes = sendSvil.mock.calls[0][1];
        expect(bytes.slice(-2)).toEqual([expected & 255, expected >> 8]);
    });
    it('imports a backup tap dance on, with a term below the minimum set to 200', () => {
        const imported = fileService.parseContent(fileService.kbinfoToSvil(keyboard(false)));
        expect(imported.tapdances?.[0]).toMatchObject({ enabled: true, tapping_term: 200 });
    });
    it.each([[0, 200], [19, 200], [20, 20], [350, 350]] as const)('imports a backup term of %s as %s', (term, expected) => {
        const imported = fileService.parseContent(fileService.kbinfoToSvil(keyboard(true, term)));
        expect(imported.tapdances?.[0].tapping_term).toBe(expected);
    });
});
describe('tap dance read', () => {
    it('reads an unusable stored term as the default and keeps the stored on bit', async () => {
        const entry = (term: number) => { const d = new Uint8Array(10); d[0] = 4; d[8] = term & 255; d[9] = term >> 8; return d; };
        const stored = [entry(0), entry(5 | 0x8000), entry(350 | 0x8000), new Uint8Array(10)];
        const sendSvil = vi.fn(async (_cmd: number, args: number[]) => {
            const i = args[0] | (args[1] << 8);
            return new Uint8Array([SvilUSB.CMD_SVIL_TAP_DANCE_GET, 0, 0, ...stored[i]]);
        });
        const kb: KeyboardInfo = { rows: 1, cols: 1, tapdance_count: stored.length };
        await new TapdanceService({ sendSvil, svilProtocolVersion: 2 } as unknown as SvilUSB).get(kb);
        expect(kb.tapdances!.map(t => [t.tapping_term, t.enabled])).toEqual([[200, false], [200, true], [350, true], [200, false]]);
    });
});
