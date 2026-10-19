import { describe, it, expect, vi } from 'vitest';
import {
  SvilUSB,
  SvilCommandRefusedError,
  SVIL_TABLE_TAP_DANCE,
  readSvilTable,
} from '../../src/services/usb.service';
import { MacroService } from '../../src/services/macro.service';
import { TapdanceService } from '../../src/services/tapdance.service';
import { ComboService } from '../../src/services/combo.service';
import { OverrideService } from '../../src/services/override.service';
import { KeyboardService } from '../../src/services/keyboard.service';
import { createTestKeyboardInfo } from '../fixtures/keyboard-info.fixture';

// Sval protocol v3: MACRO_BUFFER_* with 32-bit offsets, TABLE_SCAN, and refused writes.

const MACRO_BUFFER_SIZE = 106664;

const LE32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];

/** A fake keyboard: a macro buffer behind MACRO_BUFFER_SIZE/GET/SET, as the app sees the replies. */
function makeMacroKeyboard(version: number, buffer: Uint8Array) {
  const usb = {
    svilProtocolVersion: version,
    send: vi.fn(),
    getViaBuffer: vi.fn().mockResolvedValue(new Uint8Array(0)),
    pushViaBuffer: vi.fn().mockResolvedValue(undefined),
    sendSvil: vi.fn((cmd: number, args: number[]) => {
      if (cmd === SvilUSB.CMD_SVIL_MACRO_BUFFER_SIZE) {
        return Promise.resolve(LE32(buffer.length).reduce((v, b, i) => v + b * 2 ** (8 * i), 0));
      }
      const offset = (args[0] | (args[1] << 8) | (args[2] << 16) | (args[3] << 24)) >>> 0;
      const count = args[4];
      const outOfRange = count > 20 || offset + count > buffer.length;
      if (cmd === SvilUSB.CMD_SVIL_MACRO_BUFFER_GET) {
        if (outOfRange) return Promise.resolve(new Uint8Array([cmd, 1, ...args.slice(1, 5)]));
        return Promise.resolve(new Uint8Array([cmd, ...args.slice(0, 5), ...buffer.slice(offset, offset + count)]));
      }
      if (cmd === SvilUSB.CMD_SVIL_MACRO_BUFFER_SET) {
        if (outOfRange) return Promise.resolve(new Uint8Array([cmd, 1]));
        buffer.set(args.slice(5, 5 + count), offset);
        return Promise.resolve(new Uint8Array([cmd, 0]));
      }
      return Promise.resolve(new Uint8Array([cmd, 0]));
    }),
  };
  return usb;
}

const getCalls = (usb: ReturnType<typeof makeMacroKeyboard>, cmd: number) =>
  usb.sendSvil.mock.calls.filter(c => c[0] === cmd);

describe('Sval v3 macro buffer', () => {
  it('reads the 32-bit buffer size through Sval on v3, VIA on v2', async () => {
    for (const version of [3, 2]) {
      const usb = makeMacroKeyboard(version, new Uint8Array(MACRO_BUFFER_SIZE));
      usb.send.mockImplementation((cmd: number) => {
        if (cmd === SvilUSB.CMD_VIA_MACRO_GET_COUNT) return Promise.resolve(new Uint8Array([cmd, 0, 1]));
        if (cmd === SvilUSB.CMD_VIA_MACRO_GET_BUFFER_SIZE) return Promise.resolve(65535);
        return Promise.resolve(new Uint8Array(32));
      });
      const kbinfo = createTestKeyboardInfo();
      await new KeyboardService(usb as unknown as SvilUSB).getFeatures(kbinfo);

      const viaSizeAsked = usb.send.mock.calls.some(c => c[0] === SvilUSB.CMD_VIA_MACRO_GET_BUFFER_SIZE);
      if (version === 3) {
        expect(kbinfo.macros_size).toBe(MACRO_BUFFER_SIZE);
        expect(usb.sendSvil).toHaveBeenCalledWith(SvilUSB.CMD_SVIL_MACRO_BUFFER_SIZE, [], { uint32: true, index: 1 });
        expect(viaSizeAsked).toBe(false);
      } else {
        expect(kbinfo.macros_size).toBe(65535);
        expect(getCalls(usb, SvilUSB.CMD_SVIL_MACRO_BUFFER_SIZE)).toHaveLength(0);
        expect(viaSizeAsked).toBe(true);
      }
      expect(kbinfo.macro_count).toBe(256);
    }
  });

  it('reads in 20-byte chunks and stops at the Nth terminator, not the end of the buffer', async () => {
    const buffer = new Uint8Array(MACRO_BUFFER_SIZE).fill(0x55); // stale bytes past the macros
    const content = new TextEncoder().encode('hello\0\0world\0\0');
    buffer.set(content, 0); // 4 macros: "hello", "", "world", ""
    const usb = makeMacroKeyboard(3, buffer);
    const kbinfo = createTestKeyboardInfo({ macro_count: 4, macros_size: MACRO_BUFFER_SIZE });

    await new MacroService(usb as unknown as SvilUSB).get(kbinfo);

    const reads = getCalls(usb, SvilUSB.CMD_SVIL_MACRO_BUFFER_GET);
    expect(reads).toHaveLength(1); // all 4 terminators are in the first 20 bytes
    expect(reads[0][1]).toEqual([...LE32(0), 20]);
    expect(usb.getViaBuffer).not.toHaveBeenCalled();
    expect(kbinfo.macros!.map((m: any) => m.actions)).toEqual([
      [['text', 'hello']], [], [['text', 'world']], [],
    ]);
  });

  it('keeps reading chunks until all 256 terminators are in', async () => {
    const buffer = new Uint8Array(MACRO_BUFFER_SIZE).fill(0x55);
    // 256 macros of "abcdefghi" + NUL: 2560 bytes, 128 chunks
    for (let m = 0; m < 256; m++) buffer.set(new TextEncoder().encode('abcdefghi\0'), m * 10);
    const usb = makeMacroKeyboard(3, buffer);
    const kbinfo = createTestKeyboardInfo({ macro_count: 256, macros_size: MACRO_BUFFER_SIZE });

    await new MacroService(usb as unknown as SvilUSB).get(kbinfo);

    const reads = getCalls(usb, SvilUSB.CMD_SVIL_MACRO_BUFFER_GET);
    expect(reads).toHaveLength(128);
    expect(reads[127][1]).toEqual([...LE32(2540), 20]);
    expect(kbinfo.macros).toHaveLength(256);
    expect(kbinfo.macros![255].actions).toEqual([['text', 'abcdefghi']]);
  });

  it('stops at the end of the buffer when there are fewer terminators', async () => {
    const buffer = new Uint8Array(50).fill(0x41);
    const usb = makeMacroKeyboard(3, buffer);
    const kbinfo = createTestKeyboardInfo({ macro_count: 4, macros_size: 50 });

    await new MacroService(usb as unknown as SvilUSB).get(kbinfo);

    expect(getCalls(usb, SvilUSB.CMD_SVIL_MACRO_BUFFER_GET).map(c => c[1])).toEqual([
      [...LE32(0), 20], [...LE32(20), 20], [...LE32(40), 10],
    ]);
  });

  it('refuses an out-of-range read', async () => {
    // The keyboard's buffer is smaller than the app thinks: the read at 40 is refused
    const usb = makeMacroKeyboard(3, new Uint8Array(50).fill(0x41));
    const kbinfo = createTestKeyboardInfo({ macro_count: 4, macros_size: 100 });

    await expect(new MacroService(usb as unknown as SvilUSB).get(kbinfo)).rejects.toThrow(/refused/);
  });

  it('writes only the serialized macros, at offsets above 65535', async () => {
    const buffer = new Uint8Array(MACRO_BUFFER_SIZE).fill(0x55);
    const usb = makeMacroKeyboard(3, buffer);
    const longText = 'x'.repeat(100010);
    const kbinfo = createTestKeyboardInfo({
      macro_count: 2,
      macros_size: MACRO_BUFFER_SIZE,
      macros: [{ mid: 0, actions: [['text', longText]] }, { mid: 1, actions: [['text', 'end']] }],
    } as any);

    await new MacroService(usb as unknown as SvilUSB).push(kbinfo);

    const writes = getCalls(usb, SvilUSB.CMD_SVIL_MACRO_BUFFER_SET);
    // 100010 + NUL + "end" + NUL + one trailing NUL, as the VIA path sizes it
    const size = 100010 + 1 + 3 + 1 + 1;
    expect(writes).toHaveLength(Math.ceil(size / 20));
    const at100000 = writes.find(c => c[1][0] === 0xa0 && c[1][1] === 0x86 && c[1][2] === 0x01);
    // The last chunk: 16 bytes at 100000 (0x0186A0)
    expect(at100000![1].slice(0, 5)).toEqual([0xa0, 0x86, 0x01, 0x00, 16]);
    const last = writes[writes.length - 1][1];
    expect((last[0] | (last[1] << 8) | (last[2] << 16)) + last[4]).toBe(size);
    expect(usb.pushViaBuffer).not.toHaveBeenCalled();

    expect(buffer[100009]).toBe(0x78);
    expect(Array.from(buffer.slice(100010, 100016))).toEqual([0, 0x65, 0x6e, 0x64, 0, 0]);
    expect(buffer[size]).toBe(0x55); // nothing written past what was needed
  });

  it('surfaces an out-of-range write as SvilCommandRefusedError', async () => {
    const usb = makeMacroKeyboard(3, new Uint8Array(10));
    const kbinfo = createTestKeyboardInfo({
      macro_count: 1,
      macros_size: 30, // larger than the keyboard's buffer
      macros: [{ mid: 0, actions: [['text', 'a'.repeat(25)]] }],
    } as any);

    const err = await new MacroService(usb as unknown as SvilUSB).push(kbinfo).catch(e => e);
    expect(err).toBeInstanceOf(SvilCommandRefusedError);
    expect(err.status).toBe(1);
  });

  it('v2 firmware still reads and writes macros through VIA', async () => {
    const usb = makeMacroKeyboard(2, new Uint8Array(0));
    const kbinfo = createTestKeyboardInfo({
      macro_count: 2,
      macros_size: 100,
      macros: [{ mid: 0, actions: [['text', 'hi']] }, { mid: 1, actions: [] }],
    } as any);
    const service = new MacroService(usb as unknown as SvilUSB);

    await service.push(kbinfo);
    await service.get(kbinfo);

    expect(usb.pushViaBuffer).toHaveBeenCalledWith(SvilUSB.CMD_VIA_MACRO_SET_BUFFER, 5, expect.any(ArrayBuffer));
    expect(usb.getViaBuffer).toHaveBeenCalledWith(SvilUSB.CMD_VIA_MACRO_GET_BUFFER, 100, expect.anything(), expect.any(Function));
    expect(usb.sendSvil).not.toHaveBeenCalled();
  });
});

/** A fake keyboard holding one table, answering TABLE_SCAN (v3) and per-index GETs (v1/v2). */
function makeTableKeyboard(version: number, scanId: number, getCmd: number, size: number, used: Map<number, number[]>) {
  return {
    svilProtocolVersion: version,
    sendSvil: vi.fn((cmd: number, args: number[]) => {
      if (cmd === SvilUSB.CMD_SVIL_TABLE_SCAN) {
        const [table, lo, hi] = args;
        const start = lo | (hi << 8);
        const next = table === scanId ? [...used.keys()].sort((a, b) => a - b).find(i => i >= start) : undefined;
        if (next === undefined) return Promise.resolve(new Uint8Array([cmd, table, 0, 0, 1, ...new Uint8Array(14)]));
        return Promise.resolve(new Uint8Array([cmd, table, 1, next & 0xff, next >> 8, ...used.get(next)!]));
      }
      if (cmd === getCmd) {
        const i = version >= 2 ? args[0] | (args[1] << 8) : args[0];
        const entry = used.get(i) ?? new Array(size).fill(0);
        return Promise.resolve(new Uint8Array([cmd, ...args, ...entry]));
      }
      return Promise.resolve(new Uint8Array([cmd, 0]));
    }),
  };
}

describe('Sval v3 TABLE_SCAN', () => {
  const td = (tap: number, term: number) => [tap, 0, 0, 0, 0, 0, 0, 0, term & 0xff, (term >> 8) | 0x80];

  it('scans a sparse table, ending with an entry at 255, and fills the rest empty', async () => {
    const used = new Map([[3, td(0x04, 150)], [100, td(0x05, 200)], [255, td(0x06, 250)]]);
    const usb = makeTableKeyboard(3, 0, SvilUSB.CMD_SVIL_TAP_DANCE_GET, 10, used);
    const kbinfo = createTestKeyboardInfo({ tapdance_count: 256 });

    await new TapdanceService(usb as unknown as SvilUSB).get(kbinfo);

    expect(usb.sendSvil.mock.calls.map(c => [c[0], c[1]])).toEqual([
      [SvilUSB.CMD_SVIL_TABLE_SCAN, [0, 0, 0]],
      [SvilUSB.CMD_SVIL_TABLE_SCAN, [0, 4, 0]],
      [SvilUSB.CMD_SVIL_TABLE_SCAN, [0, 101, 0]],
      // 255 is the last index, so no request past it
    ]);
    expect(kbinfo.tapdances).toHaveLength(256);
    expect(kbinfo.tapdances![3]).toMatchObject({ idx: 3, tap: 'KC_A', tapping_term: 150 });
    expect(kbinfo.tapdances![100]).toMatchObject({ idx: 100, tap: 'KC_B', tapping_term: 200 });
    expect(kbinfo.tapdances![255]).toMatchObject({ idx: 255, tap: 'KC_C', tapping_term: 250 });
    // Unreturned entries read as all zero, except the stored term of 0, which reads as the default
    expect(kbinfo.tapdances![0]).toEqual({ enabled: false, idx: 0, tap: 'KC_NO', hold: 'KC_NO', doubletap: 'KC_NO', taphold: 'KC_NO', tapping_term: 200 });
  });

  it('stops at found = 0 after the last entry in use', async () => {
    const used = new Map([[10, td(0x04, 150)]]);
    const usb = makeTableKeyboard(3, 0, SvilUSB.CMD_SVIL_TAP_DANCE_GET, 10, used);
    const kbinfo = createTestKeyboardInfo({ tapdance_count: 256 });

    await new TapdanceService(usb as unknown as SvilUSB).get(kbinfo);

    expect(usb.sendSvil.mock.calls.map(c => c[1])).toEqual([[0, 0, 0], [0, 11, 0]]);
    expect(kbinfo.tapdances![10].tap).toBe('KC_A');
    expect(kbinfo.tapdances![11].tap).toBe('KC_NO');
  });

  it('reads an empty table in one request', async () => {
    const usb = makeTableKeyboard(3, 1, SvilUSB.CMD_SVIL_COMBO_GET, 12, new Map());
    const kbinfo = createTestKeyboardInfo({ combo_count: 256 });

    await new ComboService(usb as unknown as SvilUSB).get(kbinfo);

    expect(usb.sendSvil).toHaveBeenCalledTimes(1);
    expect(usb.sendSvil).toHaveBeenCalledWith(SvilUSB.CMD_SVIL_TABLE_SCAN, [1, 0, 0], { uint8: true });
    expect(kbinfo.combos).toHaveLength(256);
    expect(kbinfo.combos!.every(c => c.output === 'KC_NO' && c.options === 0)).toBe(true);
  });

  it('uses the right table id for each table', async () => {
    const entry = (n: number) => [0x04, 0, 0x05, 0, ...new Array(n - 4).fill(0)];
    const cases: [number, number, number, (usb: any, kb: any) => Promise<void>, (kb: any) => any][] = [
      [2, SvilUSB.CMD_SVIL_KEY_OVERRIDE_GET, 12, (u, kb) => new OverrideService(u).get(kb), kb => kb.key_overrides[7].trigger],
      [3, SvilUSB.CMD_SVIL_ALT_REPEAT_KEY_GET, 6, (u, kb) => new KeyboardService(u).getAltRepeatKeys(kb), kb => kb.alt_repeat_keys[7].keycode],
      [4, SvilUSB.CMD_SVIL_LEADER_GET, 14, (u, kb) => new KeyboardService(u).getLeaders(kb), kb => kb.leaders[7].sequence[0]],
    ];
    for (const [scanId, getCmd, size, read, pick] of cases) {
      const usb = makeTableKeyboard(3, scanId, getCmd, size, new Map([[7, entry(size)]]));
      const kbinfo = createTestKeyboardInfo({ key_override_count: 10, alt_repeat_key_count: 10, leader_count: 10 });
      await read(usb, kbinfo);
      expect(usb.sendSvil.mock.calls.map(c => c[1][0])).toEqual([scanId, scanId]);
      expect(pick(kbinfo)).toBe('KC_A');
    }
  });

  it('falls back to one GET per index on v2 and v1', async () => {
    for (const version of [2, 1]) {
      const used = new Map([[3, td(0x04, 150)]]);
      const usb = makeTableKeyboard(version, 0, SvilUSB.CMD_SVIL_TAP_DANCE_GET, 10, used);
      const entries = await readSvilTable(usb as unknown as SvilUSB, SVIL_TABLE_TAP_DANCE, 8);

      expect(usb.sendSvil).toHaveBeenCalledTimes(8);
      expect(usb.sendSvil.mock.calls.every(c => c[0] === SvilUSB.CMD_SVIL_TAP_DANCE_GET)).toBe(true);
      expect(Array.from(entries[3])).toEqual(td(0x04, 150));
      expect(Array.from(entries[0])).toEqual(new Array(10).fill(0));
    }
  });
});

describe('Refused table writes', () => {
  it('throws SvilCommandRefusedError when a SET answers a nonzero status', async () => {
    for (const version of [3, 2, 1]) {
      const usb = {
        svilProtocolVersion: version,
        sendSvil: vi.fn((cmd: number) => Promise.resolve(new Uint8Array([cmd, 1]))),
      };
      const kbinfo = createTestKeyboardInfo({
        tapdances: [{ idx: 0, tap: 'KC_A', hold: 'KC_NO', doubletap: 'KC_NO', taphold: 'KC_NO', tapping_term: 200 }],
        combos: [{ cmbid: 0, keys: ['KC_A', 'KC_B'], output: 'KC_C', options: 0 }],
        key_overrides: [{ koid: 0, trigger: 'KC_A', replacement: 'KC_B', layers: 0xffff, trigger_mods: 0, negative_mod_mask: 0, suppressed_mods: 0, options: 0 }],
        alt_repeat_keys: [{ arkid: 0, keycode: 'KC_A', alt_keycode: 'KC_B', allowed_mods: 0, options: 0 }],
        leaders: [{ ldrid: 0, sequence: ['KC_A'], output: 'KC_B', options: 0 }],
      } as any);
      const svil = new KeyboardService(usb as unknown as SvilUSB);

      for (const write of [
        () => svil.updateTapdance(kbinfo, 0),
        () => svil.updateCombo(kbinfo, 0),
        () => svil.updateKeyoverride(kbinfo, 0),
        () => svil.updateAltRepeatKey(kbinfo, 0),
        () => svil.updateLeader(kbinfo, 0),
      ]) {
        await expect(write()).rejects.toBeInstanceOf(SvilCommandRefusedError);
      }
    }
  });
});
